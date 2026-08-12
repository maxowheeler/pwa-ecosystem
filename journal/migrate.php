<?php
// migrate.php — One-time migration: journal.md → journal.json
//
// Run this ONCE by visiting it in your browser:
//   http://192.168.1.216/apps/journal/migrate.php
//
// What it does:
//   1. Reads your existing journal.md
//   2. Parses every entry using the same logic as journal-v3.2
//   3. Writes journal.json to the data directory
//   4. Does NOT delete or modify journal.md (your original is safe)
//
// After migration:
//   1. Visit journal/index.html — on first load, sync.js pulls the JSON
//      into localStorage automatically
//   2. Confirm your entries appear correctly
//   3. You can then retire migrate.php (delete or move it)

$md_file   = '/mnt/warehouse/journal/journal.md';
$json_file = '/home/shyguy/apps/data/journal/entries.json';
$json_dir  = dirname($json_file);

// ── Preflight ─────────────────────────────────────────────────────
if (!file_exists($md_file)) {
    die(json_encode(['error' => 'journal.md not found at: ' . $md_file]));
}

if (!is_dir($json_dir)) {
    mkdir($json_dir, 0755, true);
}

// ── Parse markdown entries ─────────────────────────────────────────
// Matches the exact format written by journal-v3.2:
//   ## 2026-03-06 14:32 [Journal] [followup] {Title}
//   Body text here

$content     = file_get_contents($md_file);
$raw_entries = preg_split('/\n\s*---\s*\n/', trim($content));
$entries     = [];
$skipped     = 0;

foreach ($raw_entries as $index => $raw) {
    $raw = trim($raw);
    if (empty($raw)) continue;

    $entry = [
        'id'        => null,
        'time'      => '',
        'type'      => 'Journal',
        'followup'  => false,
        'title'     => '',
        'body'      => '',
        'createdAt' => null,
    ];

    if (preg_match('/^##\s+(.+?)\s+\[(Journal|Foam)\](.*?)\n+(.*)/s', $raw, $m)) {
        $entry['time']     = trim($m[1]);
        $entry['type']     = trim($m[2]);
        $meta              = $m[3];
        $entry['body']     = trim($m[4]);
        $entry['followup'] = strpos($meta, '[followup]') !== false;

        if (preg_match('/\{(.+?)\}/', $meta, $tm)) {
            $entry['title'] = trim($tm[1]);
        }

        // Generate a stable numeric ID from the timestamp string
        // Tries to parse the timestamp; falls back to index-based ID
        $ts = strtotime($entry['time']);
        $entry['id']        = $ts !== false ? ($ts * 1000) : (1000000 + $index);
        $entry['createdAt'] = $ts !== false ? date('c', $ts) : null;

    } elseif (preg_match('/^##\s+(.+?)\n+(.*)/s', $raw, $m)) {
        // Older entries without a type tag
        $entry['time'] = trim($m[1]);
        $entry['body'] = trim($m[2]);
        $ts = strtotime($entry['time']);
        $entry['id']        = $ts !== false ? ($ts * 1000) : (1000000 + $index);
        $entry['createdAt'] = $ts !== false ? date('c', $ts) : null;

    } else {
        // Can't parse — skip and count
        $skipped++;
        continue;
    }

    $entries[] = $entry;
}

// ── Write JSON ────────────────────────────────────────────────────
$result = file_put_contents($json_file, json_encode($entries, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));

if ($result === false) {
    http_response_code(500);
    die(json_encode(['error' => 'Failed to write: ' . $json_file]));
}

// ── Report ────────────────────────────────────────────────────────
header('Content-Type: application/json');
echo json_encode([
    'status'    => 'ok',
    'migrated'  => count($entries),
    'skipped'   => $skipped,
    'output'    => $json_file,
    'note'      => 'journal.md was not modified. Visit journal/index.html to load entries into localStorage.',
], JSON_PRETTY_PRINT);
