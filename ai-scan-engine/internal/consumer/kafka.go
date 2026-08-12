package consumer

import (
	"context"
	"errors"

	"github.com/segmentio/kafka-go"
)

type Kafka struct{ normal, urgent *kafka.Reader }
type fetched struct {
	reader  *kafka.Reader
	message kafka.Message
	err     error
}

func NewKafka(brokers, topics []string, groupID string) *Kafka {
	middle := len(topics) / 2
	return &Kafka{
		normal: kafka.NewReader(kafka.ReaderConfig{Brokers: brokers, GroupID: groupID, GroupTopics: topics[:middle], MinBytes: 1, MaxBytes: 10e6}),
		urgent: kafka.NewReader(kafka.ReaderConfig{Brokers: brokers, GroupID: groupID + "-urgent", GroupTopics: topics[middle:], MinBytes: 1, MaxBytes: 10e6}),
	}
}

func (consumer *Kafka) Run(ctx context.Context, handler Handler) error {
	normal, urgent := make(chan fetched, 1), make(chan fetched, 1)
	go fetch(ctx, consumer.normal, normal)
	go fetch(ctx, consumer.urgent, urgent)
	urgentRun := 0
	for {
		var item fetched
		if urgentRun >= 5 {
			select {
			case item = <-normal:
				urgentRun = 0
			default:
				select {
				case item = <-normal:
					urgentRun = 0
				case item = <-urgent:
					urgentRun++
				case <-ctx.Done():
					return ctx.Err()
				}
			}
		} else {
			select {
			case item = <-urgent:
				urgentRun++
			default:
				select {
				case item = <-urgent:
					urgentRun++
				case item = <-normal:
					urgentRun = 0
				case <-ctx.Done():
					return ctx.Err()
				}
			}
		}
		if item.err != nil {
			return item.err
		}
		if err := handler(ctx, item.message.Value); err != nil {
			return err
		}
		if err := item.reader.CommitMessages(ctx, item.message); err != nil {
			return err
		}
	}
}

func fetch(ctx context.Context, reader *kafka.Reader, output chan<- fetched) {
	for {
		message, err := reader.FetchMessage(ctx)
		select {
		case output <- fetched{reader: reader, message: message, err: err}:
		case <-ctx.Done():
			return
		}
		if err != nil {
			return
		}
	}
}

func (consumer *Kafka) Close() error {
	return errors.Join(consumer.normal.Close(), consumer.urgent.Close())
}
