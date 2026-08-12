package skill

import "context"

type Repository interface {
	CreateSource(context.Context, CreateSourceInput) (Source, error)
	GetSource(context.Context, int64) (Source, error)
	SaveVersion(context.Context, int64, string, string) (Version, error)
	ResolveDefault(context.Context) (Source, Version, error)
}
