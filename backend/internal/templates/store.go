package templates

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const maxTemplateBytes = 5 * 1024 * 1024
const diffSampleLimit = 5

//go:embed assets/templates.json
var embeddedTemplates []byte

// TemplateRequirement 模板对参考图的要求
// 兼容 minRefs 与 min_refs 两种字段
// 需要最小参考图数量时才设置
//
// # JSON 兼容需要字段名为 MinRefs
//
// nolintlint complains about MinRefs naming; keep to align JSON field.
//
//nolint:revive
type TemplateRequirement struct {
	MinRefs int    `json:"minRefs"`
	Note    string `json:"note"`
}

func (r *TemplateRequirement) UnmarshalJSON(data []byte) error {
	var raw struct {
		MinRefs    int    `json:"minRefs"`
		MinRefsAlt int    `json:"min_refs"`
		Note       string `json:"note"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	if raw.MinRefs != 0 {
		r.MinRefs = raw.MinRefs
	} else {
		r.MinRefs = raw.MinRefsAlt
	}
	if raw.Note != "" {
		r.Note = raw.Note
	}
	return nil
}

// TemplateItem 模板条目
type TemplateItem struct {
	ID           string               `json:"id"`
	Title        string               `json:"title"`
	Channels     []string             `json:"channels"`
	Materials    []string             `json:"materials"`
	Industries   []string             `json:"industries"`
	Ratio        string               `json:"ratio"`
	Preview      string               `json:"preview"`
	Image        string               `json:"image"`
	Prompt       string               `json:"prompt,omitempty"`
	Tips         string               `json:"tips,omitempty"`
	Source       *TemplateSource      `json:"source,omitempty"`
	Tags         []string             `json:"tags,omitempty"`
	Requirements *TemplateRequirement `json:"requirements,omitempty"`
}

type TemplateSource struct {
	Name  string `json:"name"`
	Label string `json:"label,omitempty"`
	Icon  string `json:"icon,omitempty"`
	URL   string `json:"url,omitempty"`
}

// TemplateMeta 模板筛选项元数据
type TemplateMeta struct {
	Channels   []string `json:"channels"`
	Materials  []string `json:"materials"`
	Industries []string `json:"industries"`
	Ratios     []string `json:"ratios"`
	Version    string   `json:"version,omitempty"`
	UpdatedAt  string   `json:"updated_at,omitempty"`
}

// TemplatePayload 模板集合
type TemplatePayload struct {
	Meta  TemplateMeta   `json:"meta"`
	Items []TemplateItem `json:"items"`
}

type Options struct {
	RemoteURL string
	CachePath string
	Timeout   time.Duration
}

type Store struct {
	mu        sync.RWMutex
	payload   TemplatePayload
	source    string
	updatedAt time.Time
}

var store = &Store{}

type cacheMeta struct {
	ETag         string    `json:"etag"`
	LastModified string    `json:"last_modified"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func InitStore(options Options) {
	if options.Timeout == 0 {
		options.Timeout = 4 * time.Second
	}

	var meta cacheMeta

	var embeddedPayload TemplatePayload
	var cachePayload TemplatePayload
	var remotePayload TemplatePayload
	embeddedParsed := false
	cacheParsed := false
	remoteParsed := false
	embeddedValid := false
	cacheValid := false
	remoteValid := false
	activeSource := "none"

	payload, err := parsePayload(embeddedTemplates)
	if err != nil {
		log.Printf("[Templates] load embedded templates failed: %v", err)
	} else {
		embeddedParsed = true
		embeddedPayload = payload
		embeddedValid = isPayloadValid(embeddedPayload)
		if embeddedValid {
			store.set(embeddedPayload, "embedded")
			activeSource = "embedded"
		}
	}

	if options.CachePath != "" {
		if cached, err := loadFromFile(options.CachePath); err == nil {
			cacheParsed = true
			cachePayload = cached
			cacheValid = isPayloadValid(cachePayload)
			if cacheValid {
				store.set(cachePayload, "cache")
				activeSource = "cache"
			}
		} else if !os.IsNotExist(err) {
			log.Printf("[Templates] load cache failed: %v", err)
		}
		if cachedMeta, err := loadCacheMeta(options.CachePath); err == nil {
			meta = cachedMeta
		}
	}

	remoteURL := strings.TrimSpace(options.RemoteURL)
	remoteStatus := "disabled"
	if remoteURL != "" {
		remoteStatus = "pending"
		ctx, cancel := context.WithTimeout(context.Background(), options.Timeout)
		defer cancel()

		remoteData, nextMeta, notModified, err := fetchRemote(ctx, remoteURL, meta)
		if err != nil {
			log.Printf("[Templates] fetch remote templates failed: %v", err)
			remoteStatus = "fetch_failed"
		} else if notModified {
			log.Printf("[Templates] remote templates not modified, keep cache")
			remoteStatus = "not_modified"
		} else {
			remotePayload, err = parsePayload(remoteData)
			if err != nil {
				log.Printf("[Templates] parse remote templates failed: %v", err)
				remoteStatus = "parse_failed"
			} else {
				remoteParsed = true
				remoteValid = isPayloadValid(remotePayload)
				if !remoteValid {
					log.Printf("[Templates] remote templates invalid: items=%d", len(remotePayload.Items))
					remoteStatus = "invalid"
				} else {
					store.set(remotePayload, "remote")
					activeSource = "remote"
					remoteStatus = "updated"
					if options.CachePath != "" {
						if err := writeCache(options.CachePath, remoteData); err != nil {
							log.Printf("[Templates] write cache failed: %v", err)
						}
						if err := writeCacheMeta(options.CachePath, nextMeta); err != nil {
							log.Printf("[Templates] write cache meta failed: %v", err)
						}
					}
				}
			}
		}
	}

	if embeddedParsed {
		logPayloadSummary("embedded", embeddedPayload, embeddedValid)
	}
	if cacheParsed {
		logPayloadSummary("cache", cachePayload, cacheValid)
	}
	if remoteParsed {
		logPayloadSummary("remote", remotePayload, remoteValid)
	}

	if remoteStatus != "pending" {
		log.Printf("[Templates] remote status: %s", remoteStatus)
	}
	if activeSource != "none" {
		log.Printf("[Templates] active source: %s", activeSource)
	}

	if embeddedValid && cacheValid {
		logPayloadDiff("embedded", embeddedPayload, "cache", cachePayload)
	}
	if cacheValid && remoteValid {
		logPayloadDiff("cache", cachePayload, "remote", remotePayload)
	}
	if embeddedValid && remoteValid {
		logPayloadDiff("embedded", embeddedPayload, "remote", remotePayload)
	}
}

func GetTemplates() TemplatePayload {
	store.mu.RLock()
	defer store.mu.RUnlock()
	return store.payload
}

func FilterItems(items []TemplateItem, query, channel, material, industry, ratio string) []TemplateItem {
	q := strings.ToLower(strings.TrimSpace(query))
	channel = strings.TrimSpace(channel)
	material = strings.TrimSpace(material)
	industry = strings.TrimSpace(industry)
	ratio = strings.TrimSpace(ratio)

	if channel == "全部" {
		channel = ""
	}
	if material == "全部" {
		material = ""
	}
	if industry == "全部" {
		industry = ""
	}
	if ratio == "全部" {
		ratio = ""
	}

	filtered := make([]TemplateItem, 0, len(items))
	for _, item := range items {
		if q != "" {
			searchText := buildSearchText(item)
			if !strings.Contains(searchText, q) {
				continue
			}
		}
		if channel != "" && !contains(item.Channels, channel) {
			continue
		}
		if material != "" && !contains(item.Materials, material) {
			continue
		}
		if industry != "" && !contains(item.Industries, industry) {
			continue
		}
		if ratio != "" && item.Ratio != ratio {
			continue
		}
		filtered = append(filtered, item)
	}
	return filtered
}

func buildSearchText(item TemplateItem) string {
	parts := []string{item.Title}
	parts = append(parts, item.Tags...)
	parts = append(parts, item.Channels...)
	parts = append(parts, item.Materials...)
	parts = append(parts, item.Industries...)
	return strings.ToLower(strings.Join(parts, " "))
}

func contains(items []string, target string) bool {
	for _, item := range items {
		if item == target {
			return true
		}
	}
	return false
}

func (s *Store) set(payload TemplatePayload, source string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.payload = payload
	s.source = source
	s.updatedAt = time.Now()
}

type templatePayloadRaw struct {
	Meta  templateMetaRaw   `json:"meta"`
	Items []templateItemRaw `json:"items"`
}

type templateMetaRaw struct {
	Channels     []string `json:"channels"`
	Materials    []string `json:"materials"`
	Industries   []string `json:"industries"`
	Ratios       []string `json:"ratios"`
	AspectRatios []string `json:"aspect_ratios"`
	Version      string   `json:"version"`
	UpdatedAt    string   `json:"updated_at"`
	UpdatedAtAlt string   `json:"updatedAt"`
}

type templateItemRaw struct {
	ID             string               `json:"id"`
	Title          string               `json:"title"`
	Channels       []string             `json:"channels"`
	Materials      []string             `json:"materials"`
	Industries     []string             `json:"industries"`
	Ratio          string               `json:"ratio"`
	AspectRatio    string               `json:"aspect_ratio"`
	Preview        string               `json:"preview"`
	Image          string               `json:"image"`
	Prompt         string               `json:"prompt"`
	Tips           string               `json:"tips"`
	Tip            string               `json:"tip"`
	Source         *TemplateSource      `json:"source"`
	Tags           []string             `json:"tags"`
	Requirements   *TemplateRequirement `json:"requirements"`
	RefRequirement *TemplateRequirement `json:"ref_requirements"`
}

func parsePayload(data []byte) (TemplatePayload, error) {
	if len(data) == 0 {
		return TemplatePayload{}, errors.New("empty template payload")
	}
	var raw templatePayloadRaw
	if err := json.Unmarshal(data, &raw); err != nil {
		return TemplatePayload{}, err
	}

	items := make([]TemplateItem, 0, len(raw.Items))
	for _, item := range raw.Items {
		normalized := normalizeItem(item)
		if normalized.ID == "" || normalized.Title == "" {
			continue
		}
		if normalized.Image == "" && normalized.Preview == "" {
			continue
		}
		items = append(items, normalized)
	}

	meta := normalizeMeta(raw.Meta, items)

	return TemplatePayload{
		Meta:  meta,
		Items: items,
	}, nil
}

func normalizeItem(item templateItemRaw) TemplateItem {
	ratio := strings.TrimSpace(item.Ratio)
	if ratio == "" {
		ratio = strings.TrimSpace(item.AspectRatio)
	}

	requirements := item.Requirements
	if requirements == nil {
		requirements = item.RefRequirement
	}

	preview := strings.TrimSpace(item.Preview)
	image := strings.TrimSpace(item.Image)
	if image == "" && preview != "" {
		image = preview
	}
	if preview == "" && image != "" {
		preview = image
	}

	tips := strings.TrimSpace(item.Tips)
	if tips == "" {
		tips = strings.TrimSpace(item.Tip)
	}

	return TemplateItem{
		ID:           strings.TrimSpace(item.ID),
		Title:        strings.TrimSpace(item.Title),
		Channels:     item.Channels,
		Materials:    item.Materials,
		Industries:   item.Industries,
		Ratio:        ratio,
		Preview:      preview,
		Image:        image,
		Prompt:       strings.TrimSpace(item.Prompt),
		Tips:         tips,
		Source:       normalizeSource(item.Source),
		Tags:         item.Tags,
		Requirements: requirements,
	}
}

func normalizeSource(source *TemplateSource) *TemplateSource {
	if source == nil {
		return nil
	}
	name := strings.TrimSpace(source.Name)
	label := strings.TrimSpace(source.Label)
	icon := strings.TrimSpace(source.Icon)
	url := strings.TrimSpace(source.URL)
	if name == "" && label == "" && icon == "" && url == "" {
		return nil
	}
	return &TemplateSource{
		Name:  name,
		Label: label,
		Icon:  icon,
		URL:   url,
	}
}

func normalizeMeta(meta templateMetaRaw, items []TemplateItem) TemplateMeta {
	channels := normalizeList(meta.Channels, collectUnique(items, func(item TemplateItem) []string { return item.Channels }))
	materials := normalizeList(meta.Materials, collectUnique(items, func(item TemplateItem) []string { return item.Materials }))
	industries := normalizeList(meta.Industries, collectUnique(items, func(item TemplateItem) []string { return item.Industries }))
	baseRatios := meta.Ratios
	if len(baseRatios) == 0 {
		baseRatios = meta.AspectRatios
	}
	ratios := normalizeList(baseRatios, collectUnique(items, func(item TemplateItem) []string { return []string{item.Ratio} }))
	version := strings.TrimSpace(meta.Version)
	updatedAt := strings.TrimSpace(meta.UpdatedAt)
	if updatedAt == "" {
		updatedAt = strings.TrimSpace(meta.UpdatedAtAlt)
	}

	return TemplateMeta{
		Channels:   channels,
		Materials:  materials,
		Industries: industries,
		Ratios:     ratios,
		Version:    version,
		UpdatedAt:  updatedAt,
	}
}

func normalizeList(input []string, fallback []string) []string {
	list := input
	if len(list) == 0 {
		list = fallback
	}
	list = dedupe(list)
	list = ensureAllFirst(list)
	return list
}

func collectUnique(items []TemplateItem, getter func(TemplateItem) []string) []string {
	seen := make(map[string]bool)
	result := make([]string, 0)
	for _, item := range items {
		for _, value := range getter(item) {
			if value == "" || seen[value] {
				continue
			}
			seen[value] = true
			result = append(result, value)
		}
	}
	return result
}

func dedupe(items []string) []string {
	seen := make(map[string]bool)
	result := make([]string, 0, len(items))
	for _, item := range items {
		if item == "" || seen[item] {
			continue
		}
		seen[item] = true
		result = append(result, item)
	}
	return result
}

func ensureAllFirst(items []string) []string {
	if len(items) == 0 {
		return []string{"全部"}
	}
	result := make([]string, 0, len(items)+1)
	result = append(result, "全部")
	for _, item := range items {
		if item == "全部" {
			continue
		}
		result = append(result, item)
	}
	return result
}

func isPayloadValid(payload TemplatePayload) bool {
	return len(payload.Items) > 0
}

func formatMetaValue(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "-"
	}
	return trimmed
}

func logPayloadSummary(source string, payload TemplatePayload, valid bool) {
	meta := payload.Meta
	log.Printf(
		"[Templates] %s templates: items=%d version=%s updated_at=%s valid=%t",
		source,
		len(payload.Items),
		formatMetaValue(meta.Version),
		formatMetaValue(meta.UpdatedAt),
		valid,
	)
}

func logPayloadDiff(sourceA string, payloadA TemplatePayload, sourceB string, payloadB TemplatePayload) {
	onlyA, onlyB := diffItemIDs(payloadA.Items, payloadB.Items)
	if len(onlyA) == 0 && len(onlyB) == 0 {
		log.Printf("[Templates] diff %s vs %s: no changes", sourceA, sourceB)
		return
	}
	log.Printf(
		"[Templates] diff %s vs %s: %s_only=%d %s_only=%d sample_%s_only=%v sample_%s_only=%v",
		sourceA,
		sourceB,
		sourceA,
		len(onlyA),
		sourceB,
		len(onlyB),
		sourceA,
		sampleStrings(onlyA, diffSampleLimit),
		sourceB,
		sampleStrings(onlyB, diffSampleLimit),
	)
}

func diffItemIDs(itemsA []TemplateItem, itemsB []TemplateItem) ([]string, []string) {
	setA := make(map[string]struct{}, len(itemsA))
	setB := make(map[string]struct{}, len(itemsB))
	for _, item := range itemsA {
		if item.ID == "" {
			continue
		}
		setA[item.ID] = struct{}{}
	}
	for _, item := range itemsB {
		if item.ID == "" {
			continue
		}
		setB[item.ID] = struct{}{}
	}

	onlyA := make([]string, 0)
	onlyB := make([]string, 0)
	for id := range setA {
		if _, ok := setB[id]; !ok {
			onlyA = append(onlyA, id)
		}
	}
	for id := range setB {
		if _, ok := setA[id]; !ok {
			onlyB = append(onlyB, id)
		}
	}

	sort.Strings(onlyA)
	sort.Strings(onlyB)
	return onlyA, onlyB
}

func sampleStrings(values []string, limit int) []string {
	if len(values) <= limit {
		return values
	}
	return values[:limit]
}

func fetchRemote(ctx context.Context, url string, meta cacheMeta) ([]byte, cacheMeta, bool, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, cacheMeta{}, false, err
	}
	req.Header.Set("User-Agent", "BananaAI-TemplateFetcher/1.0")
	if strings.TrimSpace(meta.ETag) != "" {
		req.Header.Set("If-None-Match", meta.ETag)
	}
	if strings.TrimSpace(meta.LastModified) != "" {
		req.Header.Set("If-Modified-Since", meta.LastModified)
	}

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, cacheMeta{}, false, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotModified {
		return nil, meta, true, nil
	}
	if resp.StatusCode != http.StatusOK {
		return nil, cacheMeta{}, false, errors.New(resp.Status)
	}

	reader := io.LimitReader(resp.Body, maxTemplateBytes)
	data, err := io.ReadAll(reader)
	if err != nil {
		return nil, cacheMeta{}, false, err
	}

	nextMeta := cacheMeta{
		ETag:         strings.TrimSpace(resp.Header.Get("ETag")),
		LastModified: strings.TrimSpace(resp.Header.Get("Last-Modified")),
		UpdatedAt:    time.Now(),
	}
	return data, nextMeta, false, nil
}

func loadFromFile(path string) (TemplatePayload, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return TemplatePayload{}, err
	}
	return parsePayload(data)
}

func writeCache(path string, data []byte) error {
	dir := filepath.Dir(path)
	if dir != "." {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return err
		}
	}
	return os.WriteFile(path, data, 0644)
}

func cacheMetaPath(path string) string {
	return path + ".meta"
}

func loadCacheMeta(path string) (cacheMeta, error) {
	metaPath := cacheMetaPath(path)
	data, err := os.ReadFile(metaPath)
	if err != nil {
		return cacheMeta{}, err
	}
	var meta cacheMeta
	if err := json.Unmarshal(data, &meta); err != nil {
		return cacheMeta{}, err
	}
	return meta, nil
}

func writeCacheMeta(path string, meta cacheMeta) error {
	dir := filepath.Dir(path)
	if dir != "." {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return err
		}
	}
	meta.UpdatedAt = time.Now()
	payload, err := json.Marshal(meta)
	if err != nil {
		return err
	}
	return os.WriteFile(cacheMetaPath(path), payload, 0644)
}

// Ensure embedded file is referenced so go:embed works with static analysis.
var _ embed.FS
