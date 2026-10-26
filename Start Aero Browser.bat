@echo off
rem Double-click this file to open Aero Browser.
cd /d "%~dp0"
if not exist node_modules\electron (
  echo First start: installing Electron, this takes a minute...
  call npm install
)
start "" npx electron .
