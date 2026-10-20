#Requires -Version 7
<#
.SYNOPSIS
    Installs ListenAlongFix: builds Vencord with the plugin and installs the Spicetify extension.

.DESCRIPTION
    1. Clones (or updates) Vencord into .vencord-src
    2. Copies the plugin into src/userplugins and builds Vencord
    3. Backs up %APPDATA%\Vencord\dist and replaces it with the new build
    4. Enables the plugin in Vencord's settings.json
    5. Copies the Spicetify extension, enables it and runs `spicetify apply`

    Re-run after updating Vencord, or if a Spotify update wiped Spicetify.

.PARAMETER SkipVencord
    Only (re)install the Spicetify extension.

.PARAMETER SkipSpicetify
    Only (re)build and install the Vencord plugin.
#>
param(
    [switch]$SkipVencord,
    [switch]$SkipSpicetify
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$PluginName = "ListenAlongFix"
$ExtensionFile = "listenAlongFix.js"

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Require($cmd, $hint) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "'$cmd' not found. $hint" }
}

function Invoke-Native {
    param([string]$Exe, [string[]]$Arguments)
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Exe $($Arguments -join ' ') failed (exit $LASTEXITCODE)" }
}

if (-not $SkipVencord) {
    Require git "Install it with: winget install Git.Git"
    Require node "Install it with: winget install OpenJS.NodeJS"

    $VencordData = Join-Path $env:APPDATA "Vencord"
    $LiveDist = Join-Path $VencordData "dist"
    $SettingsFile = Join-Path $VencordData "settings\settings.json"
    if (-not (Test-Path $LiveDist)) {
        throw "Vencord doesn't seem to be installed ($LiveDist missing). Install Vencord first."
    }

    $Src = Join-Path $Root ".vencord-src"
    Step "Fetching Vencord source"
    if (Test-Path (Join-Path $Src ".git")) {
        Invoke-Native git @("-C", $Src, "pull", "--ff-only")
    } else {
        Invoke-Native git @("clone", "--depth", "1", "https://github.com/Vendicated/Vencord", $Src)
    }

    Step "Copying plugin into userplugins"
    $Dest = Join-Path $Src "src\userplugins\listenAlongFix"
    New-Item -ItemType Directory -Force $Dest | Out-Null
    Copy-Item (Join-Path $Root "vencord\listenAlongFix\*") $Dest -Recurse -Force

    Step "Building Vencord (this takes a minute)"
    # Use the pnpm version Vencord pins in package.json, no global install needed
    $pm = (Get-Content (Join-Path $Src "package.json") -Raw | ConvertFrom-Json).packageManager
    Push-Location $Src
    try {
        Invoke-Native npx @("-y", $pm, "install", "--frozen-lockfile")
        # --standalone matches the official installer: the in-app updater uses
        # GitHub releases instead of expecting a git checkout next to dist
        Invoke-Native npx @("-y", $pm, "build", "--standalone")
    } finally {
        Pop-Location
    }

    Step "Closing Discord"
    Get-Process Discord -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 2

    Step "Backing up current Vencord build"
    $Backup = Join-Path $VencordData ("dist.backup-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
    Copy-Item $LiveDist $Backup -Recurse
    Write-Host "Backup: $Backup"

    Step "Installing new build"
    $Built = Join-Path $Src "dist"
    foreach ($f in "patcher.js", "preload.js", "renderer.js", "renderer.css") {
        Get-ChildItem $Built -File -Filter "$f*" | Copy-Item -Destination $LiveDist -Force
    }

    Step "Enabling $PluginName in Vencord settings"
    if (Test-Path $SettingsFile) {
        Copy-Item $SettingsFile "$SettingsFile.bak" -Force
        $settings = Get-Content $SettingsFile -Raw | ConvertFrom-Json -AsHashtable
        if (-not $settings.ContainsKey("plugins")) { $settings.plugins = @{} }
        if (-not $settings.plugins.ContainsKey($PluginName)) { $settings.plugins[$PluginName] = @{} }
        $settings.plugins[$PluginName].enabled = $true
        $settings | ConvertTo-Json -Depth 100 | Set-Content $SettingsFile -Encoding utf8NoBOM
    } else {
        Write-Warning "settings.json not found, enable '$PluginName' manually in Vencord > Plugins."
    }

    Step "Starting Discord"
    $Update = Join-Path $env:LOCALAPPDATA "Discord\Update.exe"
    if (Test-Path $Update) { Start-Process $Update -ArgumentList "--processStart", "Discord.exe" }
}

if (-not $SkipSpicetify) {
    Require spicetify "Install Spicetify first: https://spicetify.app"

    Step "Installing Spicetify extension"
    $UserData = (spicetify path userdata).Trim()
    $ExtDir = Join-Path $UserData "Extensions"
    New-Item -ItemType Directory -Force $ExtDir | Out-Null
    Copy-Item (Join-Path $Root "spicetify\$ExtensionFile") $ExtDir -Force

    $enabled = (spicetify config extensions) -join " "
    if ($enabled -notmatch [regex]::Escape($ExtensionFile)) {
        Invoke-Native spicetify @("config", "extensions", $ExtensionFile)
    }

    # `backup apply` also re-patches Spotify if an update removed Spicetify
    & spicetify backup apply 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) { Invoke-Native spicetify @("apply") }
}

Write-Host "`nDone. Click 'Listen Along' on a friend's Spotify activity in Discord to test." -ForegroundColor Green
