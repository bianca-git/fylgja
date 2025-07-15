@echo off
REM Script to create GitHub issues from tasks.csv
REM Make sure you have Python installed and have set your GITHUB_TOKEN environment variable

echo Setting up Python environment...
python -m venv venv
call venv\Scripts\activate.bat

echo Installing dependencies...
pip install -r requirements.txt

echo.
echo Before running the script, make sure you have:
echo 1. Set your GitHub Personal Access Token as an environment variable:
echo    set GITHUB_TOKEN=your_token_here
echo.
echo 2. (Optional) Set custom repository settings:
echo    set GITHUB_REPO_OWNER=your_username
echo    set GITHUB_REPO_NAME=your_repo_name
echo    set TASKS_CSV_FILE=path_to_your_tasks.csv
echo.

pause

echo Running the GitHub issues creation script...
python create_github_issues.py

echo.
echo Script completed!
pause
