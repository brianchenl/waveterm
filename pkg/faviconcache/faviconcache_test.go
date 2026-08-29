package faviconcache

import (
	"bytes"
	"net"
	"testing"
	"time"
)

func TestRejectsNonPublicFaviconTargets(t *testing.T) {
	for _, host := range []string{"localhost", "service.localhost", "127.0.0.1", "10.0.0.1", "169.254.169.254", "100.64.0.1", "::1", "fc00::1"} {
		t.Run(host, func(t *testing.T) {
			if err := validateFaviconHost(host); err == nil {
				t.Fatalf("expected %q to be rejected", host)
			}
		})
	}
	if err := validateFaviconHost("example.com"); err != nil {
		t.Fatalf("expected public hostname to pass lexical validation: %v", err)
	}
	if !isDisallowedIP(net.ParseIP("192.168.1.1")) {
		t.Fatal("private IP was not rejected")
	}
}

func TestReadFaviconBodyEnforcesLimit(t *testing.T) {
	if _, err := readFaviconBody(bytes.NewReader(make([]byte, maxIconSize+1))); err == nil {
		t.Fatal("expected oversized favicon to be rejected")
	}
	data, err := readFaviconBody(bytes.NewReader(make([]byte, maxIconSize)))
	if err != nil || len(data) != maxIconSize {
		t.Fatalf("expected favicon at limit to pass, len=%d err=%v", len(data), err)
	}
}

func TestFaviconCacheIsBounded(t *testing.T) {
	faviconCacheLock.Lock()
	oldCache := faviconCache
	faviconCache = make(map[string]*FaviconCacheItem)
	faviconCacheLock.Unlock()
	defer func() {
		faviconCacheLock.Lock()
		faviconCache = oldCache
		faviconCacheLock.Unlock()
	}()

	for i := 0; i < maxCacheEntries+10; i++ {
		SetInCache(string(rune(i)), FaviconCacheItem{LastFetched: time.Unix(int64(i), 0)})
	}
	faviconCacheLock.Lock()
	cacheLen := len(faviconCache)
	faviconCacheLock.Unlock()
	if cacheLen != maxCacheEntries {
		t.Fatalf("expected cache size %d, got %d", maxCacheEntries, cacheLen)
	}
}

func TestFaviconCacheUsesShorterNegativeCacheDuration(t *testing.T) {
	now := time.Now()
	if !isCacheItemFresh(FaviconCacheItem{Data: "", LastFetched: now.Add(-negativeCacheDuration / 2)}, now) {
		t.Fatal("expected recent failed fetch to remain negatively cached")
	}
	if isCacheItemFresh(FaviconCacheItem{Data: "", LastFetched: now.Add(-negativeCacheDuration - time.Second)}, now) {
		t.Fatal("expected failed fetch to expire after the negative cache duration")
	}
	if !isCacheItemFresh(FaviconCacheItem{Data: "data:image/png;base64,AA==", LastFetched: now.Add(-time.Hour)}, now) {
		t.Fatal("expected successful fetch to use the longer cache duration")
	}
}
