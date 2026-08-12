<?php
// sync.php — Pi-side sync endpoint for the PWA ecosystem
// Handles push (iPhone → Pi) and pull (Pi → iPhone) for all apps.
//
// Lives at: /apps/server/sync.php
//
// Push (POST):  iPhone sends { key, data } → saved as JSON file on Pi
// Pull (GET):   iPhone requests ?app=journal&key=entries → returns { data: [...] }
//
// URL pattern (matches config.js ENDPOINTS):
//   POST /server/sync.php?app=journal
//   GET  /server/sync.php?app=journal&key=entries

// ── Config ────────────────────────────────────────────────────────
// Base directory where app data files are stored.
// Each app gets its own subdirectory: /apps/data/journal/, /apps/data/bike/, etc.
$data_base = '/home/shyguy/apps/data';

// Allowed app names — prevents directory traversal attacks
$allowed_apps = ['journal', 'bike', 'office'];

// ── CORS headers (allows iPhone on local network to reach Pi) ─────
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json');

// Handle preflight OPTIONS request
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ── Validate app param ────────────────────────────────────────────
$app = isset($_GET['app']) ? trim($_GET['app']) : '';

if (!in_array($app, $allowed_apps, true)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid or missing app parameter']);
    exit;
}

$app_dir = $data_base . '/' . $app;

// Ensure app data directory exists
if (!is_dir($app_dir)) {
    mkdir($app_dir, 0755, true);
}

// ── Route by method ───────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    handle_push($app, $app_dir);
} elseif ($_SERVER['REQUEST_METHOD'] === 'GET') {
    handle_pull($app, $app_dir);
} else {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
}

// ── Push handler (iPhone → Pi) ────────────────────────────────────
function handle_push($app, $app_dir) {
    $raw = file_get_contents('php://input');

    if (empty($raw)) {
        http_response_code(400);
        echo json_encode(['error' => 'Empty request body']);
        return;
    }

    $payload = json_decode($raw, true);

    if (!isset($payload['key']) || !isset($payload['data'])) {
        http_response_code(400);
        echo json_encode(['error' => 'Missing key or data']);
        return;
    }

    $key  = sanitize_key($payload['key']);
    $data = $payload['data'];

    if ($key === null) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid key']);
        return;
    }

    $file   = $app_dir . '/' . $key . '.json';
    $result = file_put_contents($file, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));

    if ($result === false) {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to write data file']);
        return;
    }

    echo json_encode(['status' => 'ok', 'written' => $result]);
}

// ── Pull handler (Pi → iPhone) ────────────────────────────────────
function handle_pull($app, $app_dir) {
    $key = isset($_GET['key']) ? sanitize_key($_GET['key']) : null;

    if ($key === null) {
        http_response_code(400);
        echo json_encode(['error' => 'Missing or invalid key parameter']);
        return;
    }

    $file = $app_dir . '/' . $key . '.json';

    if (!file_exists($file)) {
        // No data yet — return empty, sync.js will leave local data untouched
        echo json_encode(['data' => []]);
        return;
    }

    $raw  = file_get_contents($file);
    $data = json_decode($raw, true);

    if ($data === null) {
        http_response_code(500);
        echo json_encode(['error' => 'Corrupt data file']);
        return;
    }

    echo json_encode(['data' => $data]);
}

// ── Helpers ───────────────────────────────────────────────────────
// Sanitize storage key — only allow alphanumeric, hyphens, underscores
function sanitize_key($key) {
    $key = trim((string)$key);
    return preg_match('/^[a-zA-Z0-9_\-]+$/', $key) ? $key : null;
}
