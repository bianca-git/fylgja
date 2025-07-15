# PowerShell script to create GitHub issues from tasks.csv
# Make sure you have Python installed and have set your GITHUB_TOKEN environment variable

Write-Host "Setting up Python environment..." -ForegroundColor Green
python -m venv venv
& "venv\Scripts\Activate.ps1"

Write-Host "Installing dependencies..." -ForegroundColor Green
pip install -r requirements.txt

Write-Host ""
Write-Host "Before running the script, make sure you have:" -ForegroundColor Yellow
Write-Host "1. Set your GitHub Personal Access Token as an environment variable:" -ForegroundColor Cyan
Write-Host "   `$env:GITHUB_TOKEN = 'your_token_here'" -ForegroundColor White
Write-Host ""
Write-Host "2. (Optional) Set custom repository settings:" -ForegroundColor Cyan
Write-Host "   `$env:GITHUB_REPO_OWNER = 'your_username'" -ForegroundColor White
Write-Host "   `$env:GITHUB_REPO_NAME = 'your_repo_name'" -ForegroundColor White
Write-Host "   `$env:TASKS_CSV_FILE = 'path_to_your_tasks.csv'" -ForegroundColor White
Write-Host ""

# Check if GITHUB_TOKEN is set
if (-not $env:GITHUB_TOKEN) {
    Write-Host "ERROR: GITHUB_TOKEN environment variable is not set!" -ForegroundColor Red
    Write-Host "Please set it using: `$env:GITHUB_TOKEN = 'your_token_here'" -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

$continue = Read-Host "Do you want to proceed with creating GitHub issues? (y/N)"
if ($continue -ne 'y') {
    Write-Host "Operation cancelled." -ForegroundColor Yellow
    exit 0
}

Write-Host "Running the GitHub issues creation script..." -ForegroundColor Green
python create_github_issues.py

Write-Host ""
Write-Host "Script completed!" -ForegroundColor Green
Read-Host "Press Enter to exit"
