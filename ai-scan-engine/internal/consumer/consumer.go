package consumer

import "context"

type Handler func(context.Context, []byte) error

type Consumer interface {
	Run(context.Context, Handler) error
	Close() error
}
