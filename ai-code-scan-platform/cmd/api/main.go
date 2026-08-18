package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"ai-code-scan-platform/internal/auth"
	"ai-code-scan-platform/internal/config"
	"ai-code-scan-platform/internal/credit"
	"ai-code-scan-platform/internal/database"
	"ai-code-scan-platform/internal/modelproxy"
	"ai-code-scan-platform/internal/notification"
	"ai-code-scan-platform/internal/platformstate"
	"ai-code-scan-platform/internal/productcatalog"
	"ai-code-scan-platform/internal/review"
	"ai-code-scan-platform/internal/scan"
	"ai-code-scan-platform/internal/scanqueue"
	"ai-code-scan-platform/internal/secretstore"
	"ai-code-scan-platform/internal/skill"
	"ai-code-scan-platform/internal/threatmodel"
)

func main() {
	configuration, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}

	databaseConnection, err := database.Open(context.Background(), configuration.MySQLDSN)
	if err != nil {
		log.Fatalf("connect to MySQL: %v", err)
	}
	defer databaseConnection.Close()
	modelKeyCipher, err := secretstore.LoadOrCreate(configuration.ModelKeyPath)
	if err != nil {
		log.Fatalf("load model key encryption key: %v", err)
	}

	skillRepository := skill.NewMySQLRepository(databaseConnection)
	skillFetcher := skill.NewHTTPFetcher(configuration.SkillFetchTimeout, configuration.SkillMaxBytes)
	skillService := skill.NewServiceWithBuiltIn(skillRepository, skillFetcher, configuration.BuiltInSkillRoot)
	scanRepository := scan.NewMySQLRepository(databaseConnection).WithCallbackBaseURL(configuration.PublicAPIBaseURL)
	scanService := scan.NewService(scanRepository).
		WithSecretCipher(modelKeyCipher).
		WithRepositoryAccessVerifier(scan.NewGitRepositoryAccessVerifier(15 * time.Second))
	authService := auth.NewServiceWithSecrets(auth.NewRepository(databaseConnection), modelKeyCipher)
	if err := authService.BootstrapAdmin(context.Background(), configuration.BootstrapAdminEmail, configuration.BootstrapAdminPassword, configuration.BootstrapAdminCredits); err != nil {
		log.Fatalf("bootstrap administrator: %v", err)
	}
	authHandler := auth.NewHandler(authService).WithSSO(auth.SSOConfig{
		Enabled: configuration.SSOEnabled, Provider: configuration.SSOProvider, FrontendURL: configuration.SSOFrontendURL,
		RedirectURI: configuration.SSORedirectURI, ClientID: configuration.SSOClientID, ClientSecret: configuration.SSOClientSecret,
		AuthorizeURL: configuration.SSOAuthorizeURL, TokenURL: configuration.SSOTokenURL, UserInfoURL: configuration.SSOUserInfoURL,
		Scope: configuration.SSOScope, UserIDField: configuration.SSOUserIDField, UserNameField: configuration.SSOUserNameField,
		UserEmailField: configuration.SSOUserEmailField, UACGateway: configuration.SSOUACGateway, UACAppID: configuration.SSOUACAppID,
		UACLang: configuration.SSOUACLang, UACSource: configuration.SSOUACSource,
	}, &http.Client{Timeout: configuration.SSOTimeout})
	platformStateService := platformstate.NewService(databaseConnection, modelKeyCipher)
	feishuHTTPClient := &http.Client{Timeout: 10 * time.Second}
	feishuClient := notification.NewFeishuClient(configuration.FeishuAppID, configuration.FeishuAppSecret, configuration.FeishuAPIBaseURL, feishuHTTPClient)
	notificationService := notification.NewService(notification.NewRepository(databaseConnection), modelKeyCipher, feishuClient, configuration.SSOFrontendURL).
		WithApplicationClientProvider(func(ctx context.Context) (*notification.FeishuClient, error) {
			stateConfiguration, err := platformStateService.GetFeishuApplicationConfiguration(ctx, "default")
			if errors.Is(err, platformstate.ErrNotFound) || (err == nil && stateConfiguration.AppID == "" && stateConfiguration.AppSecret == "") {
				return feishuClient, nil
			}
			if err != nil {
				return nil, err
			}
			return notification.NewFeishuClient(stateConfiguration.AppID, stateConfiguration.AppSecret, configuration.FeishuAPIBaseURL, feishuHTTPClient), nil
		})
	scanService.WithCompletionNotifier(notificationService)
	reviewService := review.NewService(func(ctx context.Context) (json.RawMessage, error) {
		snapshot, err := platformStateService.Get(ctx, "default")
		return snapshot.State, err
	}, skillService, review.NewOpenAIClient(&http.Client{Timeout: configuration.ReviewTimeout}), modelKeyCipher, configuration.ReviewConcurrency)
	scanService.WithModelResolver(reviewService)
	modelProxyService := modelproxy.NewService(scanService, reviewService, modelKeyCipher, 10*time.Minute)
	threatModelService := threatmodel.NewService(threatmodel.NewMySQLRepository(databaseConnection), scanRepository, threatmodel.NewAnalyzer())
	dispatchContext, stopDispatcher := context.WithCancel(context.Background())
	defer stopDispatcher()
	fallbackQueueConfiguration := environmentScanQueueConfiguration(configuration)
	publisher := scanqueue.NewReloadingPublisher(func(ctx context.Context) (scanqueue.PublisherConfig, error) {
		stateConfiguration, err := platformStateService.GetScanQueueConfiguration(ctx, "default")
		if errors.Is(err, platformstate.ErrNotFound) {
			if configuration.ScanQueueBrokerURL == "" {
				return scanqueue.PublisherConfig{}, fmt.Errorf("scan queue delivery is not configured")
			}
			return fallbackQueueConfiguration, nil
		}
		if err != nil {
			return scanqueue.PublisherConfig{}, err
		}
		if stateConfiguration.Protocol == "" {
			if configuration.ScanQueueBrokerURL == "" {
				return scanqueue.PublisherConfig{}, fmt.Errorf("scan queue delivery is not configured")
			}
			return fallbackQueueConfiguration, nil
		}
		return stateScanQueueConfiguration(stateConfiguration)
	})
	dispatcher := scanqueue.NewDispatcher(scanqueue.NewOutboxRepository(databaseConnection), publisher)
	go dispatcher.Run(dispatchContext)
	log.Printf("scan queue dispatcher started; platform configuration takes effect without restart")

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, request *http.Request) {
		if err := databaseConnection.PingContext(request.Context()); err != nil {
			http.Error(w, "database unavailable", http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	skill.NewHandler(skillService, configuration.AdminToken).
		WithBuiltInRoot(configuration.BuiltInSkillRoot).
		WithDistributionRoot(configuration.DistributionSkillsRoot).
		RegisterRoutes(mux)
	authHandler.RegisterRoutes(mux)
	notification.NewHandler(notificationService, authHandler.RequireUser).RegisterRoutes(mux)
	productcatalog.NewHandler(productcatalog.NewClient(configuration.SSOUACGateway, &http.Client{Timeout: configuration.ProductCatalogTimeout}), authHandler.RequireUser, func(ctx context.Context) (productcatalog.Tokens, bool) {
		user, ok := auth.UserFromContext(ctx)
		if !ok {
			return productcatalog.Tokens{}, false
		}
		tokens, ok := authHandler.UACTokensForUser(user.ID)
		return productcatalog.Tokens{RequestToken: tokens.RequestToken, RefreshToken: tokens.RefreshToken}, ok
	}).RegisterRoutes(mux)
	credit.NewHandler(credit.NewRepository(databaseConnection), authHandler.RequireUser, authHandler.RequireAdmin).RegisterRoutes(mux)
	scan.NewHandler(scanService, configuration.AdminToken, authHandler.RequireUser).WithPluginAuthentication(authHandler.RequireAPIKey).RegisterRoutes(mux)
	platformstate.NewHandler(platformStateService, configuration.AdminToken, authHandler.RequireUser).RegisterRoutes(mux)
	review.NewHandler(reviewService, configuration.ReviewMaxBytes).RegisterRoutes(mux)
	modelproxy.NewHandler(modelProxyService, configuration.AdminToken, configuration.ReviewMaxBytes).RegisterRoutes(mux)
	threatmodel.NewHandler(threatModelService, authHandler.RequireUser).RegisterRoutes(mux)

	server := &http.Server{
		Addr:              configuration.HTTPAddress,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	log.Printf("AI code scan platform listening on %s", configuration.HTTPAddress)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func scanQueueRoute(name, routingKey, fallbackName, fallbackRoutingKey string) scanqueue.RabbitMQRoute {
	if name == "" {
		name = fallbackName
		if routingKey == "" {
			routingKey = fallbackRoutingKey
		}
	}
	if routingKey == "" {
		routingKey = name
	}
	return scanqueue.RabbitMQRoute{Queue: name, RoutingKey: routingKey}
}

func environmentScanQueueConfiguration(configuration config.Config) scanqueue.PublisherConfig {
	liteRoute := scanQueueRoute(configuration.ScanQueueLiteName, configuration.ScanQueueLiteRoutingKey, configuration.ScanQueueName, configuration.ScanQueueRoutingKey)
	standardRoute := scanQueueRoute(configuration.ScanQueueStandardName, configuration.ScanQueueStandardRoutingKey, configuration.ScanQueueName, configuration.ScanQueueRoutingKey)
	releaseRoute := scanQueueRoute(configuration.ScanQueueReleaseName, configuration.ScanQueueReleaseRoutingKey, configuration.ScanQueueName, configuration.ScanQueueRoutingKey)
	if configuration.ScanQueueProtocol == "kafka" {
		return scanqueue.PublisherConfig{Protocol: "kafka", Kafka: scanqueue.KafkaConfig{
			Brokers: splitBrokerAddresses(configuration.ScanQueueBrokerURL), Topic: standardRoute.Queue,
			Topics: map[string]string{"lite": liteRoute.Queue, "standard": standardRoute.Queue, "release": releaseRoute.Queue},
			UrgentTopics: map[string]string{
				"lite":     urgentTopic(liteRoute.Queue, configuration.ScanQueueLiteUrgentName),
				"standard": urgentTopic(standardRoute.Queue, configuration.ScanQueueStandardUrgentName),
				"release":  urgentTopic(releaseRoute.Queue, configuration.ScanQueueReleaseUrgentName),
			},
		}}
	}
	return scanqueue.PublisherConfig{Protocol: "rabbitmq", RabbitMQ: scanqueue.RabbitMQConfig{
		BrokerURL: configuration.ScanQueueBrokerURL, Queue: standardRoute.Queue,
		Exchange: configuration.ScanQueueExchange, RoutingKey: standardRoute.RoutingKey,
		Routes:         map[string]scanqueue.RabbitMQRoute{"lite": liteRoute, "standard": standardRoute, "release": releaseRoute},
		PriorityQueues: configuration.ScanQueueLiteName != "" || configuration.ScanQueueStandardName != "" || configuration.ScanQueueReleaseName != "",
	}}
}

func stateScanQueueConfiguration(configuration platformstate.ScanQueueConfiguration) (scanqueue.PublisherConfig, error) {
	if !configuration.Enabled {
		return scanqueue.PublisherConfig{}, fmt.Errorf("scan queue delivery is disabled")
	}
	if configuration.BrokerURL == "" {
		return scanqueue.PublisherConfig{}, fmt.Errorf("scan queue broker URL is not configured")
	}
	if configuration.Protocol == "kafka" {
		topics := map[string]string{"lite": configuration.LiteTopic, "standard": configuration.StandardTopic, "release": configuration.ReleaseTopic}
		for level, topic := range topics {
			if topic == "" {
				return scanqueue.PublisherConfig{}, fmt.Errorf("Kafka topic for %s is not configured", level)
			}
		}
		return scanqueue.PublisherConfig{Protocol: "kafka", Kafka: scanqueue.KafkaConfig{
			Brokers: splitBrokerAddresses(configuration.BrokerURL), Topic: topics["standard"], Topics: topics,
			UrgentTopics: map[string]string{
				"lite":     urgentTopic(topics["lite"], configuration.LiteUrgentTopic),
				"standard": urgentTopic(topics["standard"], configuration.StandardUrgentTopic),
				"release":  urgentTopic(topics["release"], configuration.ReleaseUrgentTopic),
			},
		}}, nil
	}
	if configuration.Protocol != "rabbitmq" {
		return scanqueue.PublisherConfig{}, fmt.Errorf("unsupported scan queue protocol %q", configuration.Protocol)
	}
	routes := map[string]scanqueue.RabbitMQRoute{
		"lite":     {Queue: configuration.LiteQueue, RoutingKey: configuration.LiteRoutingKey},
		"standard": {Queue: configuration.StandardQueue, RoutingKey: configuration.StandardRoutingKey},
		"release":  {Queue: configuration.ReleaseQueue, RoutingKey: configuration.ReleaseRoutingKey},
	}
	for level, route := range routes {
		if route.Queue == "" || route.RoutingKey == "" {
			return scanqueue.PublisherConfig{}, fmt.Errorf("scan queue route for %s is incomplete", level)
		}
	}
	return scanqueue.PublisherConfig{Protocol: "rabbitmq", RabbitMQ: scanqueue.RabbitMQConfig{
		BrokerURL: configuration.BrokerURL, Queue: routes["standard"].Queue,
		Exchange: configuration.Exchange, RoutingKey: routes["standard"].RoutingKey,
		Routes: routes, PriorityQueues: true,
	}}, nil
}

func splitBrokerAddresses(value string) []string {
	addresses := strings.Split(value, ",")
	result := make([]string, 0, len(addresses))
	for _, address := range addresses {
		if address = strings.TrimSpace(address); address != "" {
			result = append(result, address)
		}
	}
	return result
}

func urgentTopic(topic, configured string) string {
	if configured = strings.TrimSpace(configured); configured != "" {
		return configured
	}
	return strings.TrimSpace(topic) + ".urgent"
}
