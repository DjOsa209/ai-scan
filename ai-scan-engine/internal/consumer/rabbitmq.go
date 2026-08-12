package consumer

import (
	"context"
	"fmt"
	"log"

	amqp "github.com/rabbitmq/amqp091-go"
)

type RabbitMQ struct {
	connection *amqp.Connection
	channel    *amqp.Channel
	queues     []string
}

func NewRabbitMQ(brokerURL string, queues []string) (*RabbitMQ, error) {
	connection, err := amqp.Dial(brokerURL)
	if err != nil {
		return nil, fmt.Errorf("connect RabbitMQ: %w", err)
	}
	channel, err := connection.Channel()
	if err != nil {
		connection.Close()
		return nil, err
	}
	if err := channel.Qos(1, 0, false); err != nil {
		channel.Close()
		connection.Close()
		return nil, err
	}
	for _, queue := range queues {
		if _, err := channel.QueueDeclare(queue, true, false, false, false, amqp.Table{"x-max-priority": int32(10)}); err != nil {
			channel.Close()
			connection.Close()
			return nil, fmt.Errorf("declare queue %s: %w", queue, err)
		}
	}
	return &RabbitMQ{connection: connection, channel: channel, queues: queues}, nil
}

func (consumer *RabbitMQ) Run(ctx context.Context, handler Handler) error {
	deliveries := make(chan amqp.Delivery)
	for _, queue := range consumer.queues {
		stream, err := consumer.channel.Consume(queue, "", false, false, false, false, nil)
		if err != nil {
			return err
		}
		go func() {
			for delivery := range stream {
				select {
				case deliveries <- delivery:
				case <-ctx.Done():
					return
				}
			}
		}()
	}
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case delivery := <-deliveries:
			if err := handler(ctx, delivery.Body); err != nil {
				log.Printf("handle RabbitMQ delivery from %s: %v", delivery.RoutingKey, err)
				_ = delivery.Nack(false, true)
				continue
			}
			if err := delivery.Ack(false); err != nil {
				return err
			}
		}
	}
}

func (consumer *RabbitMQ) Close() error {
	if consumer.channel != nil {
		_ = consumer.channel.Close()
	}
	if consumer.connection != nil {
		return consumer.connection.Close()
	}
	return nil
}
