package main

import (
	"context"
	"log"
	"os/signal"
	"syscall"

	"ai-scan-engine/internal/analyzer"
	"ai-scan-engine/internal/config"
	"ai-scan-engine/internal/consumer"
	"ai-scan-engine/internal/jobstore"
	"ai-scan-engine/internal/platformclient"
	"ai-scan-engine/internal/scanner"
	"ai-scan-engine/internal/worker"
)

func main() {
	configuration, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	store, err := jobstore.Open(configuration.DatabasePath)
	if err != nil {
		log.Fatal(err)
	}
	defer store.Close()

	var queue consumer.Consumer
	if configuration.Protocol == "rabbitmq" {
		queue, err = consumer.NewRabbitMQ(configuration.BrokerURL, configuration.RabbitQueues)
	} else {
		queue = consumer.NewKafka(configuration.KafkaBrokers, configuration.KafkaTopics, configuration.KafkaGroupID)
	}
	if err != nil {
		log.Fatal(err)
	}
	defer queue.Close()

	client := platformclient.New(configuration.AdminToken, configuration.PlatformURL, configuration.CallbackTimeout, configuration.ModelTimeout)
	scannerOptions := []scanner.Option{}
	if configuration.AIEnabled {
		analyzerConfig := analyzer.Config{
			APIProtocol: configuration.ModelProtocol, Endpoint: configuration.ModelEndpoint, ModelID: configuration.ModelID, APIKey: configuration.ModelAPIKey,
			SkillRoot:   configuration.BuiltInSkillRoot,
			ProxyUserNo: configuration.ProxyUserNo, ProxyUserName: configuration.ProxyUserName, ProxyUserDeptName: configuration.ProxyUserDept,
			Temperature: configuration.ModelTemperature, MaxTokens: configuration.ModelMaxTokens,
			MaxContextBytes: configuration.ModelContextBytes, MaxBatches: configuration.ModelMaxBatches,
		}
		var modelAnalyzer *analyzer.Analyzer
		if configuration.ModelAccessMode == "platform" {
			modelAnalyzer, err = analyzer.NewPlatform(analyzerConfig, client)
		} else {
			modelAnalyzer, err = analyzer.New(analyzerConfig, configuration.ModelTimeout)
		}
		if err != nil {
			log.Fatalf("initialize AI analyzer: %v", err)
		}
		scannerOptions = append(scannerOptions, scanner.WithAnalyzer(modelAnalyzer))
		log.Printf("AI analysis enabled with %s model access and skill root %s", configuration.ModelAccessMode, configuration.BuiltInSkillRoot)
	}
	engine := worker.New(store, scanner.New(configuration.WorkRoot, configuration.MaxFileBytes, scannerOptions...), client)
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	log.Printf("AI scan engine started with %s consumer", configuration.Protocol)
	if err := queue.Run(ctx, engine.Handle); err != nil && ctx.Err() == nil {
		log.Fatal(err)
	}
}
