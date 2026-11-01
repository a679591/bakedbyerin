# Baked by Erin - one-time Cloudflare setup for shop.bakedbyerin.com
# Run from this folder in PowerShell:   powershell -ExecutionPolicy Bypass -File .\setup.ps1
# Safe to re-run: anything that already exists is skipped.

# "Continue" so Windows PowerShell doesn't treat wrangler's normal stderr output as a crash;
# each step checks $LASTEXITCODE instead.
$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

# 1. Tools
Step "Checking Node and pnpm"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js is not installed. Install the LTS version from https://nodejs.org and re-run." }
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { npm install -g pnpm }

Step "Installing project packages"
pnpm install
if ($LASTEXITCODE -ne 0) { throw "pnpm install failed" }

# 2. Cloudflare login (opens your browser the first time)
Step "Checking Cloudflare login"
$who = npx wrangler whoami 2>&1 | Out-String
if ($who -match "not authenticated|You are not") { npx wrangler login }
npx wrangler whoami

# 3. Databases and media buckets
function Get-D1Id($name) {
    $list = npx wrangler d1 list --json | Out-String | ConvertFrom-Json
    ($list | Where-Object { $_.name -eq $name }).uuid
}
function Ensure-D1($name) {
    $id = Get-D1Id $name
    if (-not $id) { Step "Creating D1 database $name"; npx wrangler d1 create $name | Out-Host; $id = Get-D1Id $name }
    else { Write-Host "D1 database $name already exists" }
    if (-not $id) { throw "Could not find the ID for D1 database $name" }
    return $id
}
function Ensure-R2($name) {
    Step "Checking R2 bucket $name"
    $out = npx wrangler r2 bucket create $name 2>&1 | Out-String
    if ($LASTEXITCODE -eq 0) { Write-Host "Created R2 bucket $name"; return }
    if ($out -match "already exists|10004") { Write-Host "R2 bucket $name already exists"; return }
    Write-Host $out
    if ($out -match "enable R2|10042") {
        throw "R2 isn't turned on for this Cloudflare account yet. In the dashboard open R2 Object Storage, click to enable it (free tier), then re-run this script."
    }
    throw "Could not create R2 bucket $name - send the message above to Claude."
}

function Get-KVId($title) {
    $list = npx wrangler kv namespace list 2>$null | Out-String | ConvertFrom-Json
    ($list | Where-Object { $_.title -eq $title -or $_.title -like "*$title" } | Select-Object -First 1).id
}
function Ensure-KV($title) {
    $id = Get-KVId $title
    if (-not $id) { Step "Creating KV namespace $title"; npx wrangler kv namespace create $title | Out-Host; $id = Get-KVId $title }
    else { Write-Host "KV namespace $title already exists" }
    if (-not $id) { throw "Could not find the ID for KV namespace $title" }
    return $id
}

$prodId    = Ensure-D1 "baked-by-erin"
$previewId = Ensure-D1 "baked-by-erin-preview"
Ensure-R2 "baked-by-erin-media"
Ensure-R2 "baked-by-erin-preview-media"
$sessionId        = Ensure-KV "baked-by-erin-session"
$previewSessionId = Ensure-KV "baked-by-erin-preview-session"

Step "Writing database and KV IDs into wrangler.jsonc"
$cfg = Get-Content wrangler.jsonc -Raw
$cfg = $cfg.Replace("REPLACE_WITH_PROD_D1_ID", $prodId).Replace("REPLACE_WITH_PREVIEW_D1_ID", $previewId)
$cfg = $cfg.Replace("REPLACE_WITH_SESSION_KV_ID", $sessionId).Replace("REPLACE_WITH_PREVIEW_SESSION_KV_ID", $previewSessionId)
Set-Content wrangler.jsonc $cfg -NoNewline
Write-Host "Production DB: $prodId"
Write-Host "Preview DB:    $previewId"
Write-Host "Session KV:    $sessionId"

# 4. Build (catches problems before anything goes live)
Step "Building the site"
pnpm build
if ($LASTEXITCODE -ne 0) { throw "Build failed - nothing was deployed. Send the error above to Claude." }

# 5. First deploy (creates the Worker and shop.bakedbyerin.com)
Step "Deploying to shop.bakedbyerin.com"
npx wrangler deploy
if ($LASTEXITCODE -ne 0) { throw "Deploy failed. Send the error above to Claude." }

# 6. Secrets (skipped if already set)
$existing = npx wrangler secret list --name baked-by-erin 2>&1 | Out-String
if ($existing -notmatch "EMDASH_ENCRYPTION_KEY") {
    Step "Setting EMDASH_ENCRYPTION_KEY"
    $key = (npx emdash secrets generate | Where-Object { $_.Trim() } | Select-Object -Last 1).Trim()
    $key = ($key -split "\s+")[-1]
    $key | npx wrangler secret put EMDASH_ENCRYPTION_KEY --name baked-by-erin
}
if ($existing -notmatch "EMDASH_AUTH_SECRET") {
    Step "Setting EMDASH_AUTH_SECRET"
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    ($bytes | ForEach-Object { $_.ToString("x2") }) -join "" | npx wrangler secret put EMDASH_AUTH_SECRET --name baked-by-erin
}

Write-Host "`nDone! Open https://shop.bakedbyerin.com/_emdash/admin to create your admin login." -ForegroundColor Green
Write-Host "(The new subdomain can take a few minutes to start answering.)"
