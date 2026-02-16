# Build WebChuGL and create bundle.zip in one step
# Usage: ./build-and-bundle.ps1 [-Clean] [-Jobs N]
#
# Equivalent to running build.ps1 followed by bundle.ps1.

$ErrorActionPreference = "Stop"

& (Join-Path $PSScriptRoot "build.ps1") @args
& (Join-Path $PSScriptRoot "bundle.ps1")
