<?php
// list-pics.php — Lists available images for the Office Status image picker.
//
// Lives at: /apps/office/list-pics.php
// Reads from the sibling /apps/office/pics/ directory.
//
// The pics/ folder is managed directly via Finder (drop PNGs in, they show
// up here) — same as shared/icons/, NOT part of the staging/deploy.sh
// workflow. No archiving/versioning needed for these, they're just assets.
//
// Returns: { "files": ["lunch.png", "focus.png", ...] } — sorted, .png only.

header('Access-Control-Allow-Origin: *');
header('Content-Type: application/json');

$pics_dir = __DIR__ . '/pics';

if (!is_dir($pics_dir)) {
    echo json_encode(['files' => []]);
    exit;
}

$entries = scandir($pics_dir);
$files = array_values(array_filter($entries, function ($f) use ($pics_dir) {
    return preg_match('/\.png$/i', $f) && is_file($pics_dir . '/' . $f);
}));

sort($files);

echo json_encode(['files' => $files]);
