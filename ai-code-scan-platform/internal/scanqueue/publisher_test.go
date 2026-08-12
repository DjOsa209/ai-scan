package scanqueue

import (
	"reflect"
	"testing"

	amqp "github.com/rabbitmq/amqp091-go"
)

type recordingRabbitMQTopologyChannel struct {
	calls []string
}

func (channel *recordingRabbitMQTopologyChannel) ExchangeDeclare(name, kind string, durable, autoDelete, internal, noWait bool, arguments amqp.Table) error {
	channel.calls = append(channel.calls, "exchange:"+name+":"+kind)
	return nil
}

func (channel *recordingRabbitMQTopologyChannel) QueueDeclare(name string, durable, autoDelete, exclusive, noWait bool, arguments amqp.Table) (amqp.Queue, error) {
	channel.calls = append(channel.calls, "queue:"+name)
	return amqp.Queue{Name: name}, nil
}

func (channel *recordingRabbitMQTopologyChannel) QueueBind(name, key, exchange string, noWait bool, arguments amqp.Table) error {
	channel.calls = append(channel.calls, "bind:"+name+":"+key+":"+exchange)
	return nil
}

func TestDeclareRabbitMQTopologyDeclaresExchangeBeforeBinding(t *testing.T) {
	channel := &recordingRabbitMQTopologyChannel{}
	config := RabbitMQConfig{
		Queue:      "security.scan.standard",
		Exchange:   "security.scan",
		RoutingKey: "security.scan.standard",
	}

	err := declareRabbitMQTopology(channel, config)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{
		"exchange:security.scan:direct",
		"queue:security.scan.standard",
		"bind:security.scan.standard:security.scan.standard:security.scan",
	}
	if !reflect.DeepEqual(channel.calls, want) {
		t.Fatalf("unexpected topology declaration order: got %v, want %v", channel.calls, want)
	}
}

func TestRabbitMQPublisherRoutesByScanLevel(t *testing.T) {
	publisher := NewRabbitMQPublisher(RabbitMQConfig{
		Queue: "scan.standard",
		Routes: map[string]RabbitMQRoute{
			"lite":    {Queue: "scan.lite"},
			"release": {Queue: "scan.release", RoutingKey: "scan.release.requested"},
		},
	})

	checks := []struct {
		payload    string
		queue      string
		routingKey string
	}{
		{`{"task":{"scanLevel":"lite","mode":"standard"}}`, "scan.lite", "scan.lite"},
		{`{"task":{"scanLevel":"release","mode":"deep"}}`, "scan.release", "scan.release.requested"},
		{`{"task":{"scanLevel":"standard","mode":"standard"}}`, "scan.standard", "scan.standard"},
		{`{"task":{"mode":"deep"}}`, "scan.release", "scan.release.requested"},
	}
	for _, check := range checks {
		route, err := publisher.routeFor([]byte(check.payload))
		if err != nil {
			t.Fatal(err)
		}
		if route.Queue != check.queue || route.RoutingKey != check.routingKey {
			t.Fatalf("unexpected route for %s: %#v", check.payload, route)
		}
	}
}

func TestKafkaPublisherRoutesByScanLevel(t *testing.T) {
	publisher := NewKafkaPublisher(KafkaConfig{
		Topic: "scan.standard",
		Topics: map[string]string{
			"lite":    "scan.lite",
			"release": "scan.release",
		},
		UrgentTopics: map[string]string{
			"lite": "scan.lite.priority",
		},
	})

	checks := []struct {
		payload string
		topic   string
	}{
		{`{"task":{"scanLevel":"lite","mode":"standard"}}`, "scan.lite"},
		{`{"task":{"scanLevel":"release","mode":"deep"}}`, "scan.release"},
		{`{"task":{"scanLevel":"standard","mode":"standard"}}`, "scan.standard"},
		{`{"task":{"mode":"deep"}}`, "scan.release"},
		{`{"task":{"scanLevel":"lite","priority":"urgent"}}`, "scan.lite.priority"},
		{`{"task":{"scanLevel":"standard","priority":"urgent"}}`, "scan.standard.urgent"},
	}
	for _, check := range checks {
		topic, err := publisher.topicFor([]byte(check.payload))
		if err != nil {
			t.Fatal(err)
		}
		if topic != check.topic {
			t.Fatalf("unexpected topic for %s: %s", check.payload, topic)
		}
	}
}

func TestScanRequestPriorityMarksUrgentMessages(t *testing.T) {
	priority, err := scanRequestPriority([]byte(`{"task":{"priority":"urgent"}}`))
	if err != nil {
		t.Fatal(err)
	}
	if priority != 5 {
		t.Fatalf("expected urgent message priority 5, got %d", priority)
	}
}
