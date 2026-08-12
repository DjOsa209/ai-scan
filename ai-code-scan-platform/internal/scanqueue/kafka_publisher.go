package scanqueue

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/segmentio/kafka-go"
)

type KafkaConfig struct {
	Brokers      []string
	Topic        string
	Topics       map[string]string
	UrgentTopics map[string]string
}

type KafkaPublisher struct {
	config KafkaConfig
	writer *kafka.Writer
}

func NewKafkaPublisher(config KafkaConfig) *KafkaPublisher {
	return &KafkaPublisher{
		config: config,
		writer: &kafka.Writer{
			Addr:         kafka.TCP(config.Brokers...),
			Balancer:     &kafka.Hash{},
			RequiredAcks: kafka.RequireAll,
			Async:        false,
		},
	}
}

func (publisher *KafkaPublisher) Publish(ctx context.Context, payload []byte) error {
	topic, err := publisher.topicFor(payload)
	if err != nil {
		return err
	}
	key, err := scanRequestKey(payload)
	if err != nil {
		return err
	}
	if err := publisher.writer.WriteMessages(ctx, kafka.Message{Topic: topic, Key: key, Value: payload}); err != nil {
		return fmt.Errorf("publish scan request to Kafka topic %s: %w", topic, err)
	}
	return nil
}

func (publisher *KafkaPublisher) topicFor(payload []byte) (string, error) {
	var envelope struct {
		Task struct {
			ScanLevel string `json:"scanLevel"`
			Mode      string `json:"mode"`
			Priority  string `json:"priority"`
		} `json:"task"`
	}
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return "", fmt.Errorf("decode scan request topic: %w", err)
	}
	level := envelope.Task.ScanLevel
	if level == "" {
		if envelope.Task.Mode == "deep" {
			level = "release"
		} else {
			level = "standard"
		}
	}
	topic := strings.TrimSpace(publisher.config.Topics[level])
	if topic == "" {
		topic = strings.TrimSpace(publisher.config.Topic)
	}
	if topic == "" {
		return "", fmt.Errorf("no Kafka topic configured for level %q", level)
	}
	if envelope.Task.Priority == "urgent" {
		if urgentTopic := strings.TrimSpace(publisher.config.UrgentTopics[level]); urgentTopic != "" {
			return urgentTopic, nil
		}
		return topic + ".urgent", nil
	}
	return topic, nil
}

func scanRequestKey(payload []byte) ([]byte, error) {
	var envelope struct {
		Task struct {
			ID string `json:"id"`
		} `json:"task"`
	}
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return nil, fmt.Errorf("decode scan request key: %w", err)
	}
	return []byte(envelope.Task.ID), nil
}

func (publisher *KafkaPublisher) Close() error {
	return publisher.writer.Close()
}
