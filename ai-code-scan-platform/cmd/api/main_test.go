package main

import (
	"reflect"
	"testing"

	"ai-code-scan-platform/internal/platformstate"
)

func TestStateScanQueueConfigurationBuildsKafkaPublisher(t *testing.T) {
	configuration, err := stateScanQueueConfiguration(platformstate.ScanQueueConfiguration{
		Enabled: true, Protocol: "kafka", BrokerURL: " kafka-1:9092, kafka-2:9092 ",
		LiteTopic: "scan.lite", StandardTopic: "scan.standard", ReleaseTopic: "scan.release",
		LiteUrgentTopic: "scan.lite.priority",
	})
	if err != nil {
		t.Fatal(err)
	}
	if configuration.Protocol != "kafka" {
		t.Fatalf("expected Kafka publisher, got %q", configuration.Protocol)
	}
	if !reflect.DeepEqual(configuration.Kafka.Brokers, []string{"kafka-1:9092", "kafka-2:9092"}) {
		t.Fatalf("unexpected Kafka brokers: %#v", configuration.Kafka.Brokers)
	}
	if configuration.Kafka.Topics["lite"] != "scan.lite" || configuration.Kafka.Topics["standard"] != "scan.standard" || configuration.Kafka.Topics["release"] != "scan.release" {
		t.Fatalf("unexpected Kafka topics: %#v", configuration.Kafka.Topics)
	}
	if configuration.Kafka.UrgentTopics["lite"] != "scan.lite.priority" || configuration.Kafka.UrgentTopics["standard"] != "scan.standard.urgent" || configuration.Kafka.UrgentTopics["release"] != "scan.release.urgent" {
		t.Fatalf("unexpected urgent Kafka topics: %#v", configuration.Kafka.UrgentTopics)
	}
}
