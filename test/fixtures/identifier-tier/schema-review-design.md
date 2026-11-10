# Schema review design

Reviewers of the schema area read the weekly summary and decide what to fix first. The summary is produced from the output of lint_schemas.py and from the ticket queue. The design keeps the two sources apart so that a noisy ticket queue never hides a failing check. Open question: whether the summary should be mailed or only posted to the team channel.
