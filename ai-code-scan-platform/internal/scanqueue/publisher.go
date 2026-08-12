package scanqueue

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
)

type Publisher interface {
	Publish(context.Context, []byte) error
	Close() error
}

type PublisherConfig struct {
	Protocol string
	RabbitMQ RabbitMQConfig
	Kafka    KafkaConfig
}

type ConfigProvider func(context.Context) (PublisherConfig, error)

type ReloadingPublisher struct {
	provider    ConfigProvider
	mutex       sync.Mutex
	fingerprint string
	publisher   Publisher
}

func NewReloadingPublisher(provider ConfigProvider) *ReloadingPublisher {
	return &ReloadingPublisher{provider: provider}
}

func (publisher *ReloadingPublisher) Publish(ctx context.Context, payload []byte) error {
	publisher.mutex.Lock()
	defer publisher.mutex.Unlock()
	configuration, err := publisher.provider(ctx)
	if err != nil {
		return err
	}
	encoded, err := json.Marshal(configuration)
	if err != nil {
		return fmt.Errorf("encode scan queue configuration: %w", err)
	}
	fingerprint := string(encoded)
	if publisher.publisher == nil || publisher.fingerprint != fingerprint {
		if publisher.publisher != nil {
			_ = publisher.publisher.Close()
		}
		publisher.publisher, err = newPublisher(configuration)
		if err != nil {
			return err
		}
		publisher.fingerprint = fingerprint
	}
	return publisher.publisher.Publish(ctx, payload)
}

func newPublisher(configuration PublisherConfig) (Publisher, error) {
	switch configuration.Protocol {
	case "rabbitmq":
		return NewRabbitMQPublisher(configuration.RabbitMQ), nil
	case "kafka":
		return NewKafkaPublisher(configuration.Kafka), nil
	default:
		return nil, fmt.Errorf("unsupported scan queue protocol %q", configuration.Protocol)
	}
}

func (publisher *ReloadingPublisher) Close() error {
	publisher.mutex.Lock()
	defer publisher.mutex.Unlock()
	if publisher.publisher == nil {
		return nil
	}
	err := publisher.publisher.Close()
	publisher.publisher = nil
	publisher.fingerprint = ""
	return err
}

type RabbitMQConfig struct {
	BrokerURL      string
	Queue          string
	Exchange       string
	RoutingKey     string
	Routes         map[string]RabbitMQRoute
	PriorityQueues bool
}

type RabbitMQRoute struct {
	Queue      string
	RoutingKey string
}

type RabbitMQPublisher struct {
	config     RabbitMQConfig
	mutex      sync.Mutex
	connection *amqp.Connection
	channel    *amqp.Channel
	confirms   <-chan amqp.Confirmation
}

type rabbitMQTopologyChannel interface {
	ExchangeDeclare(name, kind string, durable, autoDelete, internal, noWait bool, arguments amqp.Table) error
	QueueDeclare(name string, durable, autoDelete, exclusive, noWait bool, arguments amqp.Table) (amqp.Queue, error)
	QueueBind(name, key, exchange string, noWait bool, arguments amqp.Table) error
}

func NewRabbitMQPublisher(config RabbitMQConfig) *RabbitMQPublisher {
	if config.RoutingKey == "" {
		config.RoutingKey = config.Queue
	}
	for level, route := range config.Routes {
		if route.RoutingKey == "" {
			route.RoutingKey = route.Queue
		}
		config.Routes[level] = route
	}
	return &RabbitMQPublisher{config: config}
}

func (publisher *RabbitMQPublisher) Publish(ctx context.Context, payload []byte) error {
	publisher.mutex.Lock()
	defer publisher.mutex.Unlock()
	if err := publisher.connect(); err != nil {
		return err
	}
	route, err := publisher.routeFor(payload)
	if err != nil {
		return err
	}
	priority, err := scanRequestPriority(payload)
	if err != nil {
		return err
	}
	err = publisher.channel.PublishWithContext(ctx, publisher.config.Exchange, route.RoutingKey, false, false, amqp.Publishing{
		ContentType: "application/json", DeliveryMode: amqp.Persistent, Priority: priority, Timestamp: time.Now().UTC(), Body: payload,
	})
	if err != nil {
		publisher.reset()
		return fmt.Errorf("publish scan request: %w", err)
	}
	select {
	case confirmation, ok := <-publisher.confirms:
		if !ok || !confirmation.Ack {
			publisher.reset()
			return fmt.Errorf("scan queue rejected published message")
		}
		return nil
	case <-ctx.Done():
		publisher.reset()
		return ctx.Err()
	case <-time.After(10 * time.Second):
		publisher.reset()
		return fmt.Errorf("timed out waiting for scan queue publish confirmation")
	}
}

func scanRequestPriority(payload []byte) (uint8, error) {
	var envelope struct {
		Task struct {
			Priority string `json:"priority"`
		} `json:"task"`
	}
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return 0, fmt.Errorf("decode scan request priority: %w", err)
	}
	if envelope.Task.Priority == "urgent" {
		return 5, nil
	}
	return 0, nil
}

func (publisher *RabbitMQPublisher) routeFor(payload []byte) (RabbitMQRoute, error) {
	var envelope struct {
		Task struct {
			ScanLevel string `json:"scanLevel"`
			Mode      string `json:"mode"`
		} `json:"task"`
	}
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return RabbitMQRoute{}, fmt.Errorf("decode scan request route: %w", err)
	}
	level := envelope.Task.ScanLevel
	if level == "" {
		if envelope.Task.Mode == "deep" {
			level = "release"
		} else {
			level = "standard"
		}
	}
	if route, ok := publisher.config.Routes[level]; ok && route.Queue != "" {
		return route, nil
	}
	if publisher.config.Queue == "" {
		return RabbitMQRoute{}, fmt.Errorf("no scan queue configured for level %q", level)
	}
	return RabbitMQRoute{Queue: publisher.config.Queue, RoutingKey: publisher.config.RoutingKey}, nil
}

func (publisher *RabbitMQPublisher) connect() error {
	if publisher.channel != nil && !publisher.channel.IsClosed() && publisher.connection != nil && !publisher.connection.IsClosed() {
		return nil
	}
	publisher.reset()
	connection, err := amqp.Dial(publisher.config.BrokerURL)
	if err != nil {
		return fmt.Errorf("connect scan queue: %w", err)
	}
	channel, err := connection.Channel()
	if err != nil {
		_ = connection.Close()
		return fmt.Errorf("open scan queue channel: %w", err)
	}
	if err := declareRabbitMQTopology(channel, publisher.config); err != nil {
		_ = channel.Close()
		_ = connection.Close()
		return err
	}
	if err := channel.Confirm(false); err != nil {
		_ = channel.Close()
		_ = connection.Close()
		return fmt.Errorf("enable scan queue publisher confirms: %w", err)
	}
	publisher.connection = connection
	publisher.channel = channel
	publisher.confirms = channel.NotifyPublish(make(chan amqp.Confirmation, 1))
	return nil
}

func declareRabbitMQTopology(channel rabbitMQTopologyChannel, config RabbitMQConfig) error {
	if config.Exchange != "" {
		if err := channel.ExchangeDeclare(config.Exchange, "direct", true, false, false, false, nil); err != nil {
			return fmt.Errorf("declare scan exchange %s: %w", config.Exchange, err)
		}
	}
	routes := map[string]RabbitMQRoute{}
	if config.Queue != "" {
		routes[config.Queue+"\x00"+config.RoutingKey] = RabbitMQRoute{Queue: config.Queue, RoutingKey: config.RoutingKey}
	}
	for _, route := range config.Routes {
		routes[route.Queue+"\x00"+route.RoutingKey] = route
	}
	for _, route := range routes {
		arguments := amqp.Table(nil)
		if config.PriorityQueues {
			arguments = amqp.Table{"x-max-priority": int32(10)}
		}
		if _, err := channel.QueueDeclare(route.Queue, true, false, false, false, arguments); err != nil {
			return fmt.Errorf("declare scan queue %s: %w", route.Queue, err)
		}
		if config.Exchange != "" {
			if err := channel.QueueBind(route.Queue, route.RoutingKey, config.Exchange, false, nil); err != nil {
				return fmt.Errorf("bind scan queue %s: %w", route.Queue, err)
			}
		}
	}
	return nil
}

func (publisher *RabbitMQPublisher) reset() {
	if publisher.channel != nil {
		_ = publisher.channel.Close()
	}
	if publisher.connection != nil {
		_ = publisher.connection.Close()
	}
	publisher.channel = nil
	publisher.connection = nil
	publisher.confirms = nil
}

func (publisher *RabbitMQPublisher) Close() error {
	publisher.mutex.Lock()
	defer publisher.mutex.Unlock()
	var closeErr error
	if publisher.channel != nil {
		closeErr = publisher.channel.Close()
	}
	if publisher.connection != nil {
		closeErr = errors.Join(closeErr, publisher.connection.Close())
	}
	publisher.channel = nil
	publisher.connection = nil
	return closeErr
}

type Dispatcher struct {
	outbox    *OutboxRepository
	publisher Publisher
}

func NewDispatcher(outbox *OutboxRepository, publisher Publisher) *Dispatcher {
	return &Dispatcher{outbox: outbox, publisher: publisher}
}

func (dispatcher *Dispatcher) Run(ctx context.Context) {
	defer dispatcher.publisher.Close()
	for {
		item, err := dispatcher.outbox.ClaimNext(ctx)
		if errors.Is(err, context.Canceled) {
			return
		}
		if errors.Is(err, context.DeadlineExceeded) {
			continue
		}
		if errors.Is(err, sql.ErrNoRows) {
			if !dispatcher.outbox.WaitForPending(ctx, time.Second) {
				return
			}
			continue
		}
		if err != nil {
			log.Printf("claim scan queue message: %v", err)
			if !dispatcher.outbox.WaitForPending(ctx, 2*time.Second) {
				return
			}
			continue
		}
		if err := dispatcher.publisher.Publish(ctx, item.Payload); err != nil {
			log.Printf("publish scan task %s: %v", item.ScanTaskID, err)
			if recordErr := dispatcher.outbox.MarkFailed(ctx, item, err); recordErr != nil {
				log.Printf("%v", recordErr)
			}
			continue
		}
		if err := dispatcher.outbox.MarkPublished(ctx, item); err != nil {
			log.Printf("mark scan task %s published: %v", item.ScanTaskID, err)
		}
	}
}
