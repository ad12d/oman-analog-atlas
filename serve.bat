@echo off
rem Starts the Oman Analog Atlas on http://localhost:8000
cd /d "%~dp0web"
start "" http://localhost:8000
python -m http.server 8000
