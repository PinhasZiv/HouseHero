# Skills

<div dir="rtl">

הסקילים בתיקייה הזו נטענים אוטומטית בכל סשן של Claude Code שנפתח על הריפו,
כולל סשנים בענן (claude.ai/code). סשן בענן לא מתקין פלאגינים, לכן הסקילים
מועתקים לכאן ישירות מהפלאגינים שלהם.

Claude Code מזהה סקיל רק כשהוא נמצא ישירות כאן, בתיקייה `‎.claude/skills/<שם>/SKILL.md`.
לכן כל הסקילים יושבים זה לצד זה, והטבלאות למטה מראות איזה סקיל שייך לאיזו
חבילה.

</div>

## superpowers

- **Source:** [obra/superpowers](https://github.com/obra/superpowers) v7.0.0, commit
  `bb92a77741419a4ab5f06e711a283343f1ada0c3`. This is the commit that Anthropic's
  `claude-plugins-official` marketplace pins.
- **License:** MIT, © Jesse Vincent.
- **Changes from upstream:** references to `superpowers:<skill>` were changed to `<skill>`. Inside a
  repository the skills have no plugin namespace.
- **Not copied:** the plugin's SessionStart hook. That hook injects `using-superpowers` into every
  session, so here that skill loads only when Claude decides it is relevant.

| Skill | When it is used |
| :- | :- |
| `brainstorming` | Before building something new: questions, alternatives, and a design to approve |
| `writing-plans` | Turning an approved design into a step-by-step plan |
| `executing-plans` | Carrying out a plan task by task |
| `subagent-driven-development` | Carrying out a plan with subagents, with a review after each task |
| `dispatching-parallel-agents` | Several independent tasks at once |
| `test-driven-development` | Red/green: a failing test first, then the code |
| `systematic-debugging` | A bug or a failing test: root cause before a fix |
| `verification-before-completion` | Before saying "done": run the checks and show the output |
| `requesting-code-review` | A review of finished work before merging |
| `receiving-code-review` | Handling reviewer comments |
| `finishing-a-development-branch` | Wrapping up a branch: merge, PR, or cleanup |
| `using-git-worktrees` | Isolating work in a separate worktree |
| `writing-skills` | Writing and testing new skills |
| `using-superpowers` | Introduction: how to find and use the skills |
| `diagnosing-superpowers` | Analysing a session in which the skills did not work as expected |

## ui-ux-pro-max

- **Source:** [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)
  v2.15.0, commit `56ea9cf`.
- **License:** MIT, © Next Level Builder.
- **What it is:** design guidance with a local, searchable database of styles, palettes, font
  pairings, UX rules, charts and per-stack advice. It is searched with
  `python3 "${CLAUDE_SKILL_DIR}/scripts/search.py" "<query>" --domain <domain>`. The script needs
  only Python 3, with no packages to install.
- **Changes from upstream:** script paths use `${CLAUDE_SKILL_DIR}` instead of the plugin's
  `${CLAUDE_PLUGIN_ROOT}/.claude/skills/ui-ux-pro-max`. The upstream developer tests
  (`scripts/tests/`) were not copied.
- **Not copied:** the upstream plugin also ships `banner-design`, `brand`, `design`,
  `design-system`, `slides` and `ui-styling`. They cover marketing material and fonts and are not
  needed for this app.

## Updating

Copy the skill folder again from the source at the newer commit, re-apply the changes listed
above, and update the commit in this file.
