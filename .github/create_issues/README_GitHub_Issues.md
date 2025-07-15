# GitHub Issues Creator

This script automatically creates GitHub issues from the tasks defined in `tasks.csv`.

## Features

- ✅ Creates GitHub issues with detailed task information
- ✅ Applies appropriate labels based on task properties (priority, phase, status, automation category, role)
- ✅ Creates milestones for each project phase
- ✅ Formats issue descriptions with all task details
- ✅ Handles dependencies and task relationships
- ✅ Progress tracking and error handling

## Prerequisites

1. **Python 3.6+** installed on your system
2. **GitHub Personal Access Token** with repository access
3. **tasks.csv** file in the same directory

## Setup

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Set Environment Variables

#### Windows (PowerShell):
```powershell
$env:GITHUB_TOKEN = "your_github_token_here"
$env:GITHUB_REPO_OWNER = "bianca-git"  # Optional, defaults to bianca-git
$env:GITHUB_REPO_NAME = "fylgja"       # Optional, defaults to fylgja
$env:TASKS_CSV_FILE = "tasks.csv"      # Optional, defaults to tasks.csv
```

#### Windows (Command Prompt):
```cmd
set GITHUB_TOKEN=your_github_token_here
set GITHUB_REPO_OWNER=bianca-git
set GITHUB_REPO_NAME=fylgja
set TASKS_CSV_FILE=tasks.csv
```

#### Linux/Mac:
```bash
export GITHUB_TOKEN="your_github_token_here"
export GITHUB_REPO_OWNER="bianca-git"
export GITHUB_REPO_NAME="fylgja"
export TASKS_CSV_FILE="tasks.csv"
```

### 3. Create GitHub Personal Access Token

1. Go to GitHub → Settings → Developer settings → Personal access tokens
2. Generate a new token with the following permissions:
   - `repo` (Full control of private repositories)
   - `public_repo` (Access public repositories)
3. Copy the token and set it as the `GITHUB_TOKEN` environment variable

## Usage

### Option 1: Run the Python script directly
```bash
python create_github_issues.py
```

### Option 2: Use the PowerShell script (Windows)
```powershell
.\run_create_issues.ps1
```

### Option 3: Use the batch script (Windows)
```cmd
run_create_issues.bat
```

## What the Script Does

1. **Reads tasks from CSV**: Parses the `tasks.csv` file and extracts all task information
2. **Creates labels**: Sets up color-coded labels for priorities, phases, statuses, automation categories, and roles
3. **Creates milestones**: Sets up project milestones for each phase with due dates
4. **Creates issues**: Generates detailed GitHub issues with:
   - Task ID and name in the title
   - Formatted description with all task details
   - Appropriate labels based on task properties
   - Linked milestones

## Generated Labels

### Priority Labels
- `priority:high` (Red)
- `priority:medium` (Yellow)
- `priority:low` (Green)

### Phase Labels
- `phase:1` (Blue)
- `phase:2` (Orange)
- `phase:3` (Green)
- `phase:4` (Red)

### Status Labels
- `status:not-started` (Yellow)
- `status:in-progress` (Blue)
- `status:completed` (Green)
- `status:blocked` (Red)

### Automation Labels
- `automation:manus` (Purple)
- `automation:human` (Orange)
- `automation:split` (Cyan)

### Role Labels
- `role:technical-lead` (Red)
- `role:ai-ml-engineer` (Teal)
- `role:frontend-developer` (Blue)
- `role:product-manager` (Yellow)
- `role:devops-engineer` (Purple)

## Generated Milestones

- **Phase 1: Core Backend Development** (Due: 2025-08-14)
- **Phase 2: WhatsApp Integration** (Due: 2025-09-13)
- **Phase 3: Multi-Platform Expansion** (Due: 2025-11-07)
- **Phase 4: Advanced AI and Launch** (Due: 2025-12-30)

## Issue Format

Each issue will be created with:
- **Title**: `[AUTOMATION CATEGORY] Task ID: Task Name`
- **Body**: Detailed task information including:
  - Task details (ID, phase, week, duration, assignee, priority, status)
  - Start and end dates
  - Dependencies
  - Deliverables
  - Acceptance criteria
  - Automation category
  - Manus tasks
  - Human tasks
  - Notes
- **Labels**: Automatically assigned based on task properties
- **Milestone**: Assigned to the appropriate phase milestone

## Error Handling

The script includes comprehensive error handling:
- Validates environment variables
- Handles missing CSV files
- Reports API errors
- Provides progress feedback
- Summarizes success/failure counts

## Customization

You can modify the script to:
- Change label colors and descriptions
- Modify milestone due dates
- Adjust issue body formatting
- Add custom fields or processing logic

## Troubleshooting

### Common Issues:

1. **"Error: GITHUB_TOKEN environment variable is required"**
   - Make sure you've set the GITHUB_TOKEN environment variable
   - Verify the token has the correct permissions

2. **"Error: CSV file 'tasks.csv' not found"**
   - Ensure the tasks.csv file is in the same directory as the script
   - Check the TASKS_CSV_FILE environment variable if using a custom path

3. **"Failed to create issue: 401"**
   - Your GitHub token may be invalid or expired
   - Check that the token has the correct repository permissions

4. **"Failed to create issue: 422"**
   - The issue may already exist
   - Check for validation errors in the issue data

## Files Created

- `create_github_issues.py` - Main Python script
- `requirements.txt` - Python dependencies
- `run_create_issues.ps1` - PowerShell runner script
- `run_create_issues.bat` - Batch runner script
- `README_GitHub_Issues.md` - This documentation

## Support

If you encounter any issues:
1. Check the error messages in the console output
2. Verify your GitHub token permissions
3. Ensure the CSV file format matches the expected structure
4. Review the GitHub API documentation for additional troubleshooting
