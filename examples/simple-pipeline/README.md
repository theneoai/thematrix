# Simple Code Review Pipeline

This is a basic example of a multi-agent code review workflow using TheMatrix.

## Workflow Structure

```
┌──────────┐     ┌──────────────────┐
│ Analyze  │────▶│ Review Security  │────┐
│  (Code)  │     └──────────────────┘    │     ┌────────────┐
└──────────┘                               ├────▶│ Summarize  │
           │     ┌──────────────────┐    │     └────────────┘
           └────▶│ Review Performance│────┘
                 └──────────────────┘
```

## Running the Workflow

```bash
# Validate the agents
matrix agent validate analyzer.agent.yaml
matrix agent validate reviewer.agent.yaml
matrix agent validate summarizer.agent.yaml

# Validate the workflow
matrix workflow validate code-review.workflow.yaml

# Run the workflow (requires the runtime to be fully set up)
matrix workflow run simple-code-review --input input.json
```

## Agents

1. **analyzer** - Analyzes code for bugs, smells, security, and performance issues
2. **security-reviewer** - Reviews analysis from security perspective
3. **performance-reviewer** - Reviews analysis from performance perspective
4. **summarizer** - Synthesizes all reviews into an executive summary
