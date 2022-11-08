# gh-action-upsert-pr

Creates or updates a PR, where both actions are independently configurable. 

The parameters below include many pairs of `create_pr_xyz` and `update_pr_xyz` options, which allow 
you to control how a PR is created and/or updated. If you only want to create a PR, then do not specify any
`update_pr_*` parameters, and the PR will not be updated after it is created.

## Usage

Include this step in your workflow file (under `.github/workflows/`) at the point you need to
create and/or update a PR:

```yaml
steps:
  - '... Your steps ...'

  - name: Create or Update PR
    id: upsert_pr
    uses: knockaway/gh-action-upsert-pr@v1.2.0
    with:
      github_token: ${{ secrets.GITHUB_TOKEN }}
      pr_source_branch: 'feature/make-better'
      pr_destination_branch: 'master'
      create_pr_title: 'JIRA-123 Make the thing better'

  # If you need to access the outputs:
  - run: |
      echo "pr_created: ${{ steps.upsert_pr.outputs.pr_created }}"
      echo "pr_url: ${{ steps.upsert_pr.outputs.pr_url }}"
      echo "pr_number: ${{ steps.upsert_pr.outputs.pr_number }}"
```

## Inputs

### `github_token` (required)

Token to be used in the GitHub API calls.

### `pr_source_branch` (required)

The branch to use as the "from" / "head" side of the PR.

### `pr_destination_branch` (required)

The branch to use as the "to" / "base" side of the PR.

### `create_pr_title`

The title to use if creating a PR. Required if creating a PR.

### `update_pr_title`

The title to use if updating a PR. The PR title is untouched if a PR exists
and this is unspecified.

### `create_pr_body`

The description to use if creating a PR. Defaults to the template specified
by the `create_pr_template_file` input, which defaults to '.github/pull_request_template.md'.
If none of these are specified, an empty string is used as the body.

### `update_pr_body`

The description to use if updating a PR. This should be used if you want to fully overwrite
the PR description. If you only want to update part of it, look to use 
`create_pr_body_template_vars` / `update_pr_body_template_vars`. 
If none of these are specified, the PR body is untouched.

### `create_pr_reviewers`

Comma separated list of GitHub usernames to be added as reviewers if creating a PR.

### `update_pr_reviewers`

Comma separated list of GitHub usernames to be added as reviewers if updating a PR.
This will not remove any reviewers not in this list, it only ensures that reviewers
in this list are added. If a user has already submitted a review, this action will not
re-request a review from them, unless they are included in `update_pr_rerequest_reviewers`.

### `update_pr_rerequest_reviewers`

Comma separated list of GitHub usernames to request reviews from, even if they
have already reviewed the PR.

### `create_pr_draft`

Whether to create a draft PR, if creating a PR. There is no option for `update_pr_draft`
because the public GitHub API does not seem to have a way to change draft status.

### `create_pr_template_file`

If create_pr_body is not provided, create_pr_template_file can specify a template for new PRs.
default: '.github/pull_request_template.md'

### `create_pr_body_template_vars`

JSON containing key/values to replace <!-- --> markdown comment template variables, if creating a PR.
See below.

### `update_pr_body_template_vars`

JSON containing key/values to replace <!-- --> markdown comment template variables, if updating a PR.
See below.

## Outputs

### `pr_created`

"true" or "false" to indicate a PR was created or already existed.

### `pr_url`

URL of the PR, whether it was created or updated.

### `pr_number`

The PR number of the created/updated PR.

## PR Body Templates

This action also supports updating just part of a PR body / description. This can be useful if 
you have an existing PR template where you make manual updates to the PR description, but want to
insert some automatically generated text as well. For example, a list of commits, commit descriptions,
tickets, ticket descriptions, etc. 

The markdown of a PR is treated as a template which can replace the contents between open and 
close tags like this:

```
Manually edited portion of a GitHub PR description. 

<!-- MY_CUSTOM_SECTION_START -->
  Automatically generated stuff
<!-- MY_CUSTOM_SECTION_END -->
```

(The `<!-- MY_CUSTOM_SECTION_START -->` tags are markdown comments that do not actually show when
the markdown is rendered unless they are in a code block.)

If you pass this JSON string into `create_pr_body_template_vars` / `update_pr_body_template_vars`:

```json
{
  "MY_CUSTOM_SECTION": "Automatically generated stuff v2"
}
```

Then the PR description listed above would be created / updated to:

```
Manually edited portion of a GitHub PR description. 

<!-- MY_CUSTOM_SECTION_START -->
  Automatically generated stuff v2
<!-- MY_CUSTOM_SECTION_END -->
```
