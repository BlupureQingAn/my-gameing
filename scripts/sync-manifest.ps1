param(
    [string]$PresetDir = (Join-Path $PSScriptRoot "..\presets"),
    [string]$ManifestPath = (Join-Path $PSScriptRoot "..\presets\manifest.json")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-TitleHashSuffix {
    param([string]$Title)
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Title)
    $sha1 = [System.Security.Cryptography.SHA1]::Create()
    try {
        $hash = $sha1.ComputeHash($bytes)
    } finally {
        $sha1.Dispose()
    }
    $hex = [System.BitConverter]::ToString($hash).Replace("-", "").ToLowerInvariant()
    return $hex.Substring(0, 8)
}

function New-DeterministicCloudId {
    param([string]$Title)

    $slug = $Title.ToLowerInvariant()
    $slug = [System.Text.RegularExpressions.Regex]::Replace($slug, "[^a-z0-9]+", "_")
    $slug = $slug.Trim("_")
    if ([string]::IsNullOrWhiteSpace($slug)) {
        $slug = "t$(Get-TitleHashSuffix -Title $Title)"
    }
    return "cloud_$slug"
}

function Get-UniqueCloudId {
    param(
        [string]$Title,
        [hashtable]$IdToTitleMap
    )

    $baseId = New-DeterministicCloudId -Title $Title
    $candidate = $baseId
    $suffix = 2
    while ($IdToTitleMap.ContainsKey($candidate) -and $IdToTitleMap[$candidate] -ne $Title) {
        $candidate = "{0}_{1}" -f $baseId, $suffix
        $suffix++
    }
    return $candidate
}

if (-not (Test-Path -LiteralPath $PresetDir)) {
    throw "Preset directory not found: $PresetDir"
}

$manifestItems = @()
if (Test-Path -LiteralPath $ManifestPath) {
    $raw = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8
    if (-not [string]::IsNullOrWhiteSpace($raw)) {
        $parsed = $raw | ConvertFrom-Json
        $manifestItems = @($parsed)
    }
}

$defaultTheme = "network-template"
$defaultSource = "imported"
foreach ($item in $manifestItems) {
    if ($item.PSObject.Properties["theme"] -and -not [string]::IsNullOrWhiteSpace([string]$item.theme)) {
        $defaultTheme = [string]$item.theme
        break
    }
}
foreach ($item in $manifestItems) {
    if ($item.PSObject.Properties["source"] -and -not [string]::IsNullOrWhiteSpace([string]$item.source)) {
        $defaultSource = [string]$item.source
        break
    }
}

$idToTitle = @{}
$titleToEntry = @{}
foreach ($item in $manifestItems) {
    if ($null -ne $item.id -and $null -ne $item.title) {
        $idToTitle[[string]$item.id] = [string]$item.title
        $titleToEntry[[string]$item.title] = $item
    }
}

$txtFiles = Get-ChildItem -LiteralPath $PresetDir -Filter "*.txt" -File | Sort-Object Name
$addedCount = 0
$updatedIdCount = 0

foreach ($file in $txtFiles) {
    $title = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)

    if ($titleToEntry.ContainsKey($title)) {
        $entry = $titleToEntry[$title]
        $oldId = [string]$entry.id

        # Keep existing ids stable; only upgrade auto_* ids.
        $desiredId = $oldId
        if ($oldId -match "^auto_") {
            $desiredId = Get-UniqueCloudId -Title $title -IdToTitleMap $idToTitle
        }

        if ($oldId -ne $desiredId) {
            if ($idToTitle.ContainsKey($oldId) -and $idToTitle[$oldId] -eq $title) {
                $idToTitle.Remove($oldId)
            }
            $entry.id = $desiredId
            $updatedIdCount++
        }

        if (-not $entry.PSObject.Properties["theme"]) {
            $entry | Add-Member -NotePropertyName "theme" -NotePropertyValue $defaultTheme
        }
        if (-not $entry.PSObject.Properties["source"]) {
            $entry | Add-Member -NotePropertyName "source" -NotePropertyValue $defaultSource
        }

        $idToTitle[[string]$entry.id] = $title
        continue
    }

    $newId = Get-UniqueCloudId -Title $title -IdToTitleMap $idToTitle
    $newEntry = [PSCustomObject]@{
        id     = $newId
        title  = $title
        theme  = $defaultTheme
        source = $defaultSource
    }
    $manifestItems += $newEntry
    $titleToEntry[$title] = $newEntry
    $idToTitle[$newId] = $title
    $addedCount++
}

$json = $manifestItems | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText($ManifestPath, $json, [System.Text.UTF8Encoding]::new($false))

Write-Output ("Updated manifest: added={0}, updatedIds={1}, total={2}" -f $addedCount, $updatedIdCount, $manifestItems.Count)
