#!/usr/bin/env python3
"""
Script to create GitHub issues from tasks.csv file.
This script reads the CSV file and creates GitHub issues for each task.
"""

import csv
import os
import sys
from typing import Dict, List, Optional
import requests
from dataclasses import dataclass


@dataclass
class Task:
    """Data class to represent a task from the CSV"""

    task_id: str
    task_name: str
    phase: str
    week: str
    duration: str
    assignee: str
    dependencies: str
    priority: str
    status: str
    start_date: str
    end_date: str
    deliverables: str
    acceptance_criteria: str
    automation_category: str
    manus_tasks: str
    human_tasks: str
    notes: str


class GitHubIssueCreator:
    """Class to handle GitHub issue creation from tasks"""

    def __init__(self, token: str, repo_owner: str, repo_name: str):
        self.token = token
        self.repo_owner = repo_owner
        self.repo_name = repo_name
        self.base_url = f"https://api.github.com/repos/{repo_owner}/{repo_name}"
        self.headers = {
            "Authorization": f"token {token}",
            "Accept": "application/vnd.github.v3+json",
        }
        self.session = requests.Session()
        self.session.headers.update(self.headers)

    def read_tasks_from_csv(self, csv_file: str) -> List[Task]:
        """Read tasks from CSV file and return list of Task objects"""
        tasks = []
        try:
            with open(csv_file, "r", encoding="utf-8") as file:
                reader = csv.DictReader(file)
                for row in reader:
                    task = Task(
                        task_id=row["Task ID"],
                        task_name=row["Task Name"],
                        phase=row["Phase"],
                        week=row["Week"],
                        duration=row["Duration (Days)"],
                        assignee=row["Assignee"],
                        dependencies=row["Dependencies"],
                        priority=row["Priority"],
                        status=row["Status"],
                        start_date=row["Start Date"],
                        end_date=row["End Date"],
                        deliverables=row["Deliverables"],
                        acceptance_criteria=row["Acceptance Criteria"],
                        automation_category=row["Automation Category"],
                        manus_tasks=row["Manus Tasks"],
                        human_tasks=row["Human Tasks"],
                        notes=row["Notes"],
                    )
                    tasks.append(task)
        except FileNotFoundError:
            print(f"Error: CSV file '{csv_file}' not found")
            sys.exit(1)
        except Exception as e:
            print(f"Error reading CSV file: {e}")
            sys.exit(1)

        return tasks

    def create_issue_body(self, task: Task) -> str:
        """Create formatted issue body from task data"""

        # Parse deliverables into checklist format
        deliverables_list = []
        if task.deliverables:
            for deliverable in task.deliverables.split(", "):
                deliverables_list.append(f"- [ ] {deliverable.strip()}")

        # Parse acceptance criteria into checklist format
        acceptance_criteria_list = []
        if task.acceptance_criteria:
            for criteria in task.acceptance_criteria.split(", "):
                acceptance_criteria_list.append(f"- [ ] {criteria.strip()}")

        # Determine automation-specific sections
        automation_section = ""
        definition_of_done = ""

        if task.automation_category.upper() == "HUMAN":
            automation_section = """
## Description
Brief description of what needs to be done by a human team member.

**HUMAN Only:** This task requires human intervention for strategic decisions, user research, or quality validation.

## Human Actions Required
- [ ] Account setup/management
- [ ] Strategic decisions
- [ ] User research
- [ ] Quality validation
- [ ] Legal/compliance review
- [ ] Other: ___________"""

            definition_of_done = """
## Definition of Done
- [ ] Documentation updated
- [ ] All required actions completed
- [ ] Next steps identified
- [ ] Stakeholders notified"""

        elif task.automation_category.upper() == "MANUS":
            automation_section = """
## Description
Brief description of what needs to be implemented using AI automation.

**MANUS Only:** This task can be fully automated using AI tools and does not require human intervention.

## Manus Implementation Required
- [ ] Code generation
- [ ] Configuration files
- [ ] Documentation
- [ ] Testing framework
- [ ] Other: ___________"""

            definition_of_done = """
## Definition of Done
- [ ] Code implemented and tested
- [ ] Tests passing
- [ ] Ready for human review"""

        elif task.automation_category.upper() == "SPLIT":
            automation_section = """
## Description
Brief description of what needs to be done through combined human and AI efforts.

**SPLIT Only:** This task is split between human and AI efforts.

## Split Implementation Required
- [ ] Manus automation
- [ ] Human oversight
- [ ] Integration validation
- [ ] Other: ___________"""

            definition_of_done = """
## Definition of Done
- [ ] Manus automation completed
- [ ] Human oversight completed
- [ ] Integration validated
- [ ] Ready for next phase"""

        body = f"""## Task Overview
**Task ID:** {task.task_id}
**Phase:** {task.phase}
**Week:** {task.week}
**Duration:** {task.duration} days
**Priority:** {task.priority}
{automation_section}

## Deliverables
{chr(10).join(deliverables_list) if deliverables_list else "- [ ] To be defined"}

## Acceptance Criteria
{chr(10).join(acceptance_criteria_list) if acceptance_criteria_list else "- [ ] To be defined"}

## Dependencies
List any tasks that must be completed before this one:
{f"- {task.dependencies}" if task.dependencies else "None"}

## Resources Needed
- Access to: ___________
- Credentials for: ___________
- Approval from: ___________

## Notes
{task.notes if task.notes else "No additional notes"}
{definition_of_done}

---

**Start Date:** {task.start_date}  
**End Date:** {task.end_date}  
**Assignee:** {task.assignee}  
**Status:** {task.status}  
"""
        return body

    def get_labels_for_task(self, task: Task) -> List[str]:
        """Generate appropriate labels for the task"""
        labels = []  # Status labels
        if task.status:
            status_label = task.status.lower().replace(" ", "-")
            labels.append(f"status:{status_label}")

        # Phase labels
        if task.phase:
            labels.append(f"phase:{task.phase}")

        # Automation category labels
        if task.automation_category:
            labels.append(f"automation:{task.automation_category.lower()}")

        # Assignee role labels
        if task.assignee:
            if "technical lead" in task.assignee.lower():
                labels.append("role:technical-lead")
            if "ai/ml engineer" in task.assignee.lower():
                labels.append("role:ai-ml-engineer")
            if "frontend developer" in task.assignee.lower():
                labels.append("role:frontend-developer")
            if "product manager" in task.assignee.lower():
                labels.append("role:product-manager")
            if "devops engineer" in task.assignee.lower():
                labels.append("role:devops-engineer")

        # Add generic task label
        labels.append("task")

        return labels

    def create_issue(self, task: Task) -> Optional[Dict]:
        """Create a GitHub issue for the given task"""
        issue_data = {
            "title": f"{task.task_id}: [{task.automation_category.upper()}] {task.task_name}",
            "body": self.create_issue_body(task),
            "labels": self.get_labels_for_task(task),
        }

        try:
            response = self.session.post(f"{self.base_url}/issues", json=issue_data)

            if response.status_code == 201:
                issue = response.json()
                print(
                    f"✓ Created issue #{issue['number']}: {task.task_id} - {task.task_name}"
                )
                return issue
            else:
                print(
                    f"✗ Failed to create issue for {task.task_id}: {response.status_code}"
                )
                print(f"Response: {response.text}")
                return None

        except Exception as e:
            print(f"✗ Error creating issue for {task.task_id}: {e}")
            return None

    def create_labels(self) -> None:
        """Create necessary labels in the repository"""
        labels_to_create = [
            # Priority labels
            {
                "name": "priority:high",
                "color": "d73a4a",
                "description": "High priority task",
            },
            {
                "name": "priority:medium",
                "color": "fbca04",
                "description": "Medium priority task",
            },
            {
                "name": "priority:low",
                "color": "0e8a16",
                "description": "Low priority task",
            },
            # Phase labels
            {"name": "phase:1", "color": "1f77b4", "description": "Phase 1 task"},
            {"name": "phase:2", "color": "ff7f0e", "description": "Phase 2 task"},
            {"name": "phase:3", "color": "2ca02c", "description": "Phase 3 task"},
            {"name": "phase:4", "color": "d62728", "description": "Phase 4 task"},
            # Status labels
            {
                "name": "status:todo",
                "color": "e4e669",
                "description": "Task not started",
            },
            {
                "name": "status:in-progress",
                "color": "0052cc",
                "description": "Task in progress",
            },
            {
                "name": "status:closed",
                "color": "0e8a16",
                "description": "Task completed",
            },
            {
                "name": "status:blocked",
                "color": "d73a4a",
                "description": "Task blocked",
            },
            # Automation labels
            {
                "name": "automation:manus",
                "color": "8b5cf6",
                "description": "Can be automated by Manus",
            },
            {
                "name": "automation:human",
                "color": "f59e0b",
                "description": "Requires human intervention",
            },
            {
                "name": "automation:split",
                "color": "06b6d4",
                "description": "Mixed automation and human tasks",
            },
            # Role labels
            {
                "name": "role:technical-lead",
                "color": "ff6b6b",
                "description": "Technical Lead tasks",
            },
            {
                "name": "role:ai-ml-engineer",
                "color": "4ecdc4",
                "description": "AI/ML Engineer tasks",
            },
            {
                "name": "role:frontend-developer",
                "color": "45b7d1",
                "description": "Frontend Developer tasks",
            },
            {
                "name": "role:product-manager",
                "color": "f9ca24",
                "description": "Product Manager tasks",
            },
            {
                "name": "role:devops-engineer",
                "color": "6c5ce7",
                "description": "DevOps Engineer tasks",
            },
            # Generic labels
            {"name": "task", "color": "7057ff", "description": "General task"},
        ]

        print("Creating labels...")
        for label in labels_to_create:
            try:
                response = self.session.post(f"{self.base_url}/labels", json=label)
                if response.status_code == 201:
                    print(f"✓ Created label: {label['name']}")
                elif response.status_code == 422:
                    # Label already exists
                    print(f"→ Label already exists: {label['name']}")
                else:
                    print(
                        f"✗ Failed to create label {label['name']}: {response.status_code}"
                    )
            except Exception as e:
                print(f"✗ Error creating label {label['name']}: {e}")

        print("Labels creation completed.\n")

    def create_milestone(
        self, name: str, description: str, due_date: Optional[str] = None
    ) -> Optional[Dict]:
        """Create a milestone in the repository"""
        milestone_data = {"title": name, "description": description, "state": "open"}

        if due_date:
            milestone_data["due_on"] = due_date

        try:
            response = self.session.post(
                f"{self.base_url}/milestones", json=milestone_data
            )

            if response.status_code == 201:
                milestone = response.json()
                print(f"✓ Created milestone: {name}")
                return milestone
            elif response.status_code == 422:
                print(f"→ Milestone already exists: {name}")
                return None
            else:
                print(f"✗ Failed to create milestone {name}: {response.status_code}")
                return None

        except Exception as e:
            print(f"✗ Error creating milestone {name}: {e}")
            return None

    def create_milestones(self) -> None:
        """Create milestones for each phase"""
        milestones = [
            {
                "name": "Phase 1: Core Backend Development",
                "description": "Foundation setup and core processing functions",
                "due_date": "2025-08-14T23:59:59Z",
            },
            {
                "name": "Phase 2: WhatsApp Integration",
                "description": "WhatsApp integration and enhanced features",
                "due_date": "2025-09-13T23:59:59Z",
            },
            {
                "name": "Phase 3: Multi-Platform Expansion",
                "description": "Google Assistant integration and legacy features",
                "due_date": "2025-11-07T23:59:59Z",
            },
            {
                "name": "Phase 4: Advanced AI and Launch",
                "description": "Machine learning integration and production launch",
                "due_date": "2025-12-30T23:59:59Z",
            },
        ]

        print("Creating milestones...")
        for milestone in milestones:
            self.create_milestone(
                milestone["name"], milestone["description"], milestone["due_date"]
            )
        print("Milestones creation completed.\n")

    def process_all_tasks(self, csv_file: str) -> None:
        """Process all tasks from CSV and create GitHub issues"""
        print(f"Reading tasks from {csv_file}...")
        tasks = self.read_tasks_from_csv(csv_file)
        print(f"Found {len(tasks)} tasks to process.\n")

        # Create labels and milestones first
        self.create_labels()
        self.create_milestones()

        # Create issues
        print("Creating GitHub issues...")
        success_count = 0
        failed_count = 0

        for task in tasks:
            issue = self.create_issue(task)
            if issue:
                success_count += 1
            else:
                failed_count += 1

        print("\nSummary:")
        print(f"✓ Successfully created: {success_count} issues")
        print(f"✗ Failed to create: {failed_count} issues")
        print(f"Total processed: {len(tasks)} tasks")


def main():
    """Main function to run the script"""
    # Check for required environment variables
    github_token = os.getenv("GITHUB_TOKEN")
    if not github_token:
        print("Error: GITHUB_TOKEN environment variable is required")
        print("Please set your GitHub personal access token:")
        print("export GITHUB_TOKEN=your_token_here")
        sys.exit(1)

    # Default repository settings (can be overridden by environment variables)
    repo_owner = os.getenv("GITHUB_REPO_OWNER", "bianca-git")
    repo_name = os.getenv("GITHUB_REPO_NAME", "fylgja")
    csv_file = os.getenv("TASKS_CSV_FILE", "tasks_redesigned.csv")

    print(f"GitHub Repository: {repo_owner}/{repo_name}")
    print(f"CSV File: {csv_file}")
    print(f"GitHub Token: {'*' * (len(github_token) - 4)}{github_token[-4:]}")
    print()

    # Confirm before proceeding
    confirm = input("Do you want to proceed with creating GitHub issues? (y/N): ")
    if confirm.lower() != "y":
        print("Operation cancelled.")
        sys.exit(0)

    # Create the GitHub issue creator and process tasks
    creator = GitHubIssueCreator(github_token, repo_owner, repo_name)
    creator.process_all_tasks(csv_file)


if __name__ == "__main__":
    main()
