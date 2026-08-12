package auth

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const ssoStateCookieName = "platform_sso_state"

type SSOConfig struct {
	Enabled        bool
	Provider       string
	FrontendURL    string
	RedirectURI    string
	ClientID       string
	ClientSecret   string
	AuthorizeURL   string
	TokenURL       string
	UserInfoURL    string
	Scope          string
	UserIDField    string
	UserNameField  string
	UserEmailField string
	UACGateway     string
	UACAppID       string
	UACLang        string
	UACSource      string
}

type ssoClient struct {
	configuration SSOConfig
	httpClient    *http.Client
}

type UACCallbackInput struct {
	State        string            `json:"state"`
	Token        string            `json:"token"`
	UToken       string            `json:"utoken"`
	RefreshToken string            `json:"refreshToken"`
	RToken       string            `json:"rtoken"`
	EmployeeNo   string            `json:"employeeNo"`
	Employee     string            `json:"employee"`
	UserID       string            `json:"userId"`
	Params       map[string]string `json:"params"`
}

func (client *ssoClient) authorizationURL(state string) (string, error) {
	configuration := client.configuration
	if configuration.Provider == "uac" {
		endpoint := strings.TrimRight(configuration.UACGateway, "/") + "/uac-auth-service/v2/api/uac-auth/login/redirect/web-login"
		query := url.Values{"appId": {configuration.UACAppID}, "redirect": {configuration.RedirectURI}, "lang": {configuration.UACLang}, "type": {"simple"}}
		if configuration.UACSource != "" {
			query.Set("source", configuration.UACSource)
		}
		parsed, err := url.Parse(configuration.RedirectURI)
		if err != nil {
			return "", err
		}
		redirectQuery := parsed.Query()
		redirectQuery.Set("state", state)
		parsed.RawQuery = redirectQuery.Encode()
		query.Set("redirect", parsed.String())
		return endpoint + "?" + query.Encode(), nil
	}
	query := url.Values{"response_type": {"code"}, "client_id": {configuration.ClientID}, "redirect_uri": {configuration.RedirectURI}, "scope": {configuration.Scope}, "state": {state}}
	return configuration.AuthorizeURL + "?" + query.Encode(), nil
}

func (client *ssoClient) identity(ctx context.Context, request *http.Request) (SSOIdentity, error) {
	if client.configuration.Provider == "uac" {
		return client.uacIdentity(ctx, request)
	}
	return client.oauthIdentity(ctx, request.URL.Query().Get("code"))
}

func (client *ssoClient) oauthIdentity(ctx context.Context, code string) (SSOIdentity, error) {
	if code == "" {
		return SSOIdentity{}, errors.New("missing SSO callback code")
	}
	form := url.Values{"grant_type": {"authorization_code"}, "code": {code}, "redirect_uri": {client.configuration.RedirectURI}, "client_id": {client.configuration.ClientID}, "client_secret": {client.configuration.ClientSecret}}
	request, _ := http.NewRequestWithContext(ctx, http.MethodPost, client.configuration.TokenURL, strings.NewReader(form.Encode()))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := client.httpClient.Do(request)
	if err != nil {
		return SSOIdentity{}, errors.New("SSO token exchange request failed")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return SSOIdentity{}, fmt.Errorf("SSO token exchange returned HTTP %d", response.StatusCode)
	}
	var token struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&token); err != nil || token.AccessToken == "" {
		return SSOIdentity{}, errors.New("SSO token response is invalid")
	}
	profileRequest, _ := http.NewRequestWithContext(ctx, http.MethodGet, client.configuration.UserInfoURL, nil)
	profileRequest.Header.Set("Authorization", "Bearer "+token.AccessToken)
	profileResponse, err := client.httpClient.Do(profileRequest)
	if err != nil {
		return SSOIdentity{}, errors.New("SSO userinfo request failed")
	}
	defer profileResponse.Body.Close()
	if profileResponse.StatusCode != http.StatusOK {
		return SSOIdentity{}, fmt.Errorf("SSO userinfo returned HTTP %d", profileResponse.StatusCode)
	}
	var profile map[string]any
	if err := json.NewDecoder(io.LimitReader(profileResponse.Body, 1<<20)).Decode(&profile); err != nil {
		return SSOIdentity{}, errors.New("SSO userinfo response is invalid")
	}
	return identityFromProfile(profile, client.configuration), nil
}

func (client *ssoClient) uacIdentity(ctx context.Context, callback *http.Request) (SSOIdentity, error) {
	query := callback.URL.Query()
	params := make(map[string]string, len(query))
	for key := range query {
		params[key] = query.Get(key)
	}
	return client.uacIdentityFromInput(ctx, UACCallbackInput{Params: params})
}

func (client *ssoClient) uacIdentityFromInput(ctx context.Context, input UACCallbackInput) (SSOIdentity, error) {
	requestToken := firstNonEmpty(input.Token, input.RefreshToken, input.param("token", "refreshToken", "refresh_token", "P-Auth", "p_auth", "pAuth", "accessToken", "access_token"))
	userToken := firstNonEmpty(input.RToken, input.UToken, input.param("rtoken", "rToken", "RToken", "utoken", "uToken", "UToken", "P-Rtoken", "p_rtoken", "pRtoken"))
	employeeNo := firstNonEmpty(input.EmployeeNo, input.Employee, input.UserID, input.param("employeeNo", "employee_no", "employee", "empNo", "staffNo", "jobNo", "workNo", "userId", "user_id"))
	if requestToken == "" || userToken == "" {
		return SSOIdentity{}, errors.New("UAC callback is missing token or rtoken")
	}
	body, _ := json.Marshal(map[string]string{"rtoken": requestToken, "utoken": userToken, "appId": client.configuration.UACAppID})
	request, _ := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(client.configuration.UACGateway, "/")+"/uac-auth-service/v2/api/uac-auth/utoken/getUserInfo", bytes.NewReader(body))
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("P-Auth", requestToken)
	request.Header.Set("P-Rtoken", userToken)
	request.Header.Set("P-AppId", client.configuration.UACAppID)
	response, err := client.httpClient.Do(request)
	if err != nil {
		return SSOIdentity{}, errors.New("UAC getUserInfo request failed")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return SSOIdentity{}, uacResponseError(response, requestToken, userToken)
	}
	var profile map[string]any
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&profile); err != nil {
		return SSOIdentity{}, errors.New("UAC getUserInfo response is invalid")
	}
	profile = nestedProfile(profile, "data", "result", "user", "userInfo")
	identity := SSOIdentity{Provider: "uac", Subject: firstString(profile, "uid", "userId", "id", "employeeNo"), Email: firstString(profile, "email", "mail"), Name: firstString(profile, "realName", "name", "displayName", "userName"), EmployeeNo: firstString(profile, "employeeNo", "employeeNumber", "empNo", "jobNo", "workNo"), Department: firstString(profile, "deptName", "departmentName", "department", "dept"), RequestToken: requestToken, RefreshToken: userToken}
	if identity.Subject == "" {
		identity.Subject = employeeNo
	}
	if identity.EmployeeNo == "" {
		identity.EmployeeNo = employeeNo
	}
	return identity, nil
}

func uacResponseError(response *http.Response, tokens ...string) error {
	detail := struct {
		Code    any    `json:"code"`
		Message string `json:"message"`
		Msg     string `json:"msg"`
	}{}
	if err := json.NewDecoder(io.LimitReader(response.Body, 16<<10)).Decode(&detail); err != nil {
		return fmt.Errorf("UAC getUserInfo returned HTTP %d", response.StatusCode)
	}
	message := firstNonEmpty(detail.Message, detail.Msg)
	for _, token := range tokens {
		if token != "" {
			message = strings.ReplaceAll(message, token, "[REDACTED]")
		}
	}
	code := strings.TrimSpace(fmt.Sprint(detail.Code))
	if code == "" || code == "<nil>" {
		code = "unknown"
	}
	if len(message) > 256 {
		message = message[:256]
	}
	if message == "" {
		return fmt.Errorf("UAC getUserInfo returned HTTP %d (%s)", response.StatusCode, code)
	}
	return fmt.Errorf("UAC getUserInfo returned HTTP %d (%s: %s)", response.StatusCode, code, message)
}

func nestedProfile(profile map[string]any, keys ...string) map[string]any {
	for {
		found := false
		for _, key := range keys {
			if nested, ok := profile[key].(map[string]any); ok {
				profile = nested
				found = true
				break
			}
		}
		if !found {
			return profile
		}
	}
}

func (input UACCallbackInput) param(keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(input.Params[key]); value != "" {
			return value
		}
	}
	for paramKey, value := range input.Params {
		for _, key := range keys {
			if strings.EqualFold(paramKey, key) && strings.TrimSpace(value) != "" {
				return strings.TrimSpace(value)
			}
		}
	}
	for encodedQuery, value := range input.Params {
		if strings.TrimSpace(value) != "" || !strings.Contains(encodedQuery, "=") {
			continue
		}
		query, err := url.ParseQuery(strings.TrimPrefix(encodedQuery, "?"))
		if err != nil {
			continue
		}
		if value := firstValue(query, keys...); value != "" {
			return value
		}
		for queryKey, queryValues := range query {
			for _, key := range keys {
				if strings.EqualFold(queryKey, key) && len(queryValues) > 0 && strings.TrimSpace(queryValues[0]) != "" {
					return strings.TrimSpace(queryValues[0])
				}
			}
		}
	}
	return ""
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}

func identityFromProfile(profile map[string]any, configuration SSOConfig) SSOIdentity {
	return SSOIdentity{Provider: configuration.Provider, Subject: firstString(profile, configuration.UserIDField, "sub", "user_id"), Email: firstString(profile, configuration.UserEmailField, "email", "mail"), Name: firstString(profile, configuration.UserNameField, "name", "display_name"), EmployeeNo: firstString(profile, "employeeNo", "employee_no"), Department: firstString(profile, "deptName", "department")}
}

func firstValue(values url.Values, keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(values.Get(key)); value != "" {
			return value
		}
	}
	return ""
}
func firstString(values map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := values[key]; ok {
			if text := strings.TrimSpace(fmt.Sprint(value)); text != "" {
				return text
			}
		}
	}
	return ""
}
func statesMatch(expected, actual string) bool {
	return len(expected) == len(actual) && subtle.ConstantTimeCompare([]byte(expected), []byte(actual)) == 1
}

func ssoStateCookie(request *http.Request, value string, expires time.Time) *http.Cookie {
	maxAge := int(time.Until(expires).Seconds())
	if value == "" {
		maxAge = -1
	}
	return &http.Cookie{Name: ssoStateCookieName, Value: value, Path: "/", HttpOnly: true, Secure: !isLocalhost(request.Host), SameSite: http.SameSiteLaxMode, Expires: expires, MaxAge: maxAge}
}
