// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package faviconcache

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"mime"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/panichandler"
)

// --- Constants and Types ---

// cacheDuration is how long a cached entry is considered “fresh.”
const cacheDuration = 24 * time.Hour
const negativeCacheDuration = 15 * time.Minute

// maxIconSize limits the favicon size to 256 KB.
const maxIconSize = 256 * 1024 // in bytes
const maxCacheEntries = 512
const maxConcurrentFetches = 5

// FaviconCacheItem represents one cached favicon entry.
type FaviconCacheItem struct {
	// Data is the base64-encoded data URL string (e.g. "data:image/png;base64,...")
	Data string
	// LastFetched is when this entry was last updated.
	LastFetched time.Time
}

// --- Global variables for managing in-flight fetches ---
// We use a mutex and a simple map to prevent multiple simultaneous fetches for the same domain.
var (
	fetchLock sync.Mutex
	fetching  = make(map[string]bool)
)

var (
	faviconCacheLock sync.Mutex
	faviconCache     = make(map[string]*FaviconCacheItem)
)

// --- GetFavicon ---
//
// GetFavicon takes a URL string and returns a base64-encoded src URL for an <img>
// tag. If the favicon is already in cache and “fresh,” it returns it immediately.
// Otherwise it kicks off a background fetch (if one isn’t already in progress)
// and returns whatever is in the cache (which may be empty).
func GetFavicon(urlStr string) string {
	// Parse the URL and extract the domain.
	parsedURL, err := url.Parse(urlStr)
	if err != nil {
		log.Printf("GetFavicon: invalid URL %q: %v", urlStr, err)
		return ""
	}
	if parsedURL.Scheme != "http" && parsedURL.Scheme != "https" {
		log.Printf("GetFavicon: unsupported URL scheme in %q", urlStr)
		return ""
	}
	domain := strings.TrimSuffix(strings.ToLower(parsedURL.Hostname()), ".")
	if domain == "" {
		log.Printf("GetFavicon: no hostname found in URL %q", urlStr)
		return ""
	}
	if err := validateFaviconHost(domain); err != nil {
		log.Printf("GetFavicon: unsafe hostname in %q: %v", urlStr, err)
		return ""
	}

	// Try to get from our cache.
	item, found := GetFromCache(domain)
	if found {
		// If the cached entry is not stale, return it.
		if isCacheItemFresh(item, time.Now()) {
			return item.Data
		}
	}

	// Either the item was not found or it’s stale:
	// Launch an async fetch if one isn’t already running for this domain.
	triggerAsyncFetch(domain)

	// Return the cached value (even if stale or empty).
	return item.Data
}

func isCacheItemFresh(item FaviconCacheItem, now time.Time) bool {
	duration := cacheDuration
	if item.Data == "" {
		duration = negativeCacheDuration
	}
	return now.Sub(item.LastFetched) < duration
}

// triggerAsyncFetch starts a goroutine to update the favicon cache
// for the given domain if one isn’t already in progress.
func triggerAsyncFetch(domain string) {
	fetchLock.Lock()
	if fetching[domain] {
		// Already fetching this domain; nothing to do.
		fetchLock.Unlock()
		return
	}
	if len(fetching) >= maxConcurrentFetches {
		fetchLock.Unlock()
		return
	}
	// Mark this domain as in-flight.
	fetching[domain] = true
	fetchLock.Unlock()

	go func() {
		defer func() {
			panichandler.PanicHandler("Favicon:triggerAsyncFetch", recover())
		}()

		// When done, ensure that we clear the “fetching” flag.
		defer func() {
			fetchLock.Lock()
			delete(fetching, domain)
			fetchLock.Unlock()
		}()

		iconStr, err := fetchFavicon(domain)
		if err != nil {
			log.Printf("triggerAsyncFetch: error fetching favicon for %s: %v", domain, err)
		}
		SetInCache(domain, FaviconCacheItem{Data: iconStr, LastFetched: time.Now()})
	}()
}

var disallowedIPRanges = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("192.0.0.0/24"),
	netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("2001:db8::/32"),
}

func isDisallowedIP(ip net.IP) bool {
	addr, ok := netip.AddrFromSlice(ip)
	if !ok {
		return true
	}
	addr = addr.Unmap()
	if addr.IsLoopback() || addr.IsPrivate() || addr.IsLinkLocalUnicast() || addr.IsLinkLocalMulticast() || addr.IsMulticast() || addr.IsUnspecified() {
		return true
	}
	for _, prefix := range disallowedIPRanges {
		if prefix.Contains(addr) {
			return true
		}
	}
	return false
}

func validateFaviconHost(host string) error {
	host = strings.TrimSuffix(strings.ToLower(host), ".")
	if host == "" || len(host) > 253 || strings.Contains(host, "%") {
		return fmt.Errorf("invalid hostname")
	}
	if host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return fmt.Errorf("local hostname is not allowed")
	}
	if ip := net.ParseIP(host); ip != nil && isDisallowedIP(ip) {
		return fmt.Errorf("non-public IP address is not allowed")
	}
	return nil
}

func safeFaviconDialContext(ctx context.Context, network string, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, fmt.Errorf("invalid dial address: %w", err)
	}
	if err := validateFaviconHost(host); err != nil {
		return nil, err
	}
	resolved, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, err
	}
	if len(resolved) == 0 {
		return nil, fmt.Errorf("hostname resolved to no addresses")
	}
	for _, resolvedAddr := range resolved {
		if isDisallowedIP(resolvedAddr.IP) {
			return nil, fmt.Errorf("hostname resolves to a non-public IP address")
		}
	}
	dialer := &net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}
	var lastErr error
	for _, resolvedAddr := range resolved {
		conn, dialErr := dialer.DialContext(ctx, network, net.JoinHostPort(resolvedAddr.IP.String(), port))
		if dialErr == nil {
			return conn, nil
		}
		lastErr = dialErr
	}
	return nil, lastErr
}

var faviconHTTPClient = &http.Client{
	Transport: &http.Transport{
		Proxy:                 nil,
		DialContext:           safeFaviconDialContext,
		ForceAttemptHTTP2:     true,
		TLSHandshakeTimeout:   5 * time.Second,
		ResponseHeaderTimeout: 5 * time.Second,
	},
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return fmt.Errorf("too many redirects")
		}
		if req.URL.Scheme != "https" {
			return fmt.Errorf("redirect to non-HTTPS URL is not allowed")
		}
		return validateFaviconHost(req.URL.Hostname())
	},
}

func readFaviconBody(body io.Reader) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(body, maxIconSize+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxIconSize {
		return nil, fmt.Errorf("favicon too large: more than %d bytes", maxIconSize)
	}
	return data, nil
}

func fetchFavicon(domain string) (string, error) {
	// Create a context that times out after 5 seconds.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Special case for github.com - use their dark favicon from assets domain
	url := "https://" + domain + "/favicon.ico"
	if domain == "github.com" {
		url = "https://github.githubassets.com/favicons/favicon-dark.png"
	}

	// Create a new HTTP request with the context.
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return "", fmt.Errorf("error creating request for %s: %w", url, err)
	}

	// Execute the HTTP request.
	resp, err := faviconHTTPClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("error fetching favicon from %s: %w", url, err)
	}
	defer resp.Body.Close()

	// Ensure we got a 200 OK.
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("non-OK HTTP status: %d fetching %s", resp.StatusCode, url)
	}
	if resp.ContentLength > maxIconSize {
		return "", fmt.Errorf("favicon too large: %d bytes", resp.ContentLength)
	}

	// Read the favicon bytes.
	data, err := readFaviconBody(resp.Body)
	if err != nil {
		return "", fmt.Errorf("error reading favicon data from %s: %w", url, err)
	}

	// Encode the image bytes to base64.
	// Try to detect MIME type from Content-Type header first
	mimeType := resp.Header.Get("Content-Type")
	if mimeType == "" {
		// If no Content-Type header, detect from content
		mimeType = http.DetectContentType(data)
	}
	mediaType, _, err := mime.ParseMediaType(mimeType)
	if err != nil {
		return "", fmt.Errorf("invalid MIME type: %s", mimeType)
	}
	mimeType = mediaType

	if !strings.HasPrefix(mimeType, "image/") {
		return "", fmt.Errorf("unexpected MIME type: %s", mimeType)
	}
	b64Data := base64.StdEncoding.EncodeToString(data)

	return "data:" + mimeType + ";base64," + b64Data, nil
}

// TODO store in blockstore

func GetFromCache(key string) (FaviconCacheItem, bool) {
	faviconCacheLock.Lock()
	defer faviconCacheLock.Unlock()
	item, found := faviconCache[key]
	if !found {
		return FaviconCacheItem{}, false
	}
	return *item, true
}

func SetInCache(key string, item FaviconCacheItem) {
	faviconCacheLock.Lock()
	defer faviconCacheLock.Unlock()
	if _, exists := faviconCache[key]; !exists && len(faviconCache) >= maxCacheEntries {
		var oldestKey string
		var oldestTime time.Time
		for cacheKey, cacheItem := range faviconCache {
			if oldestKey == "" || cacheItem.LastFetched.Before(oldestTime) {
				oldestKey = cacheKey
				oldestTime = cacheItem.LastFetched
			}
		}
		delete(faviconCache, oldestKey)
	}
	faviconCache[key] = &item
}
