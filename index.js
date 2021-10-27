'use strict';

const fs = require('fs');
const core = require('@actions/core');
const github = require('@actions/github');

module.exports = { main };

/**
 * @typedef {import("@octokit/plugin-rest-endpoint-methods/dist-types/generated/method-types").RestEndpointMethods} GitHubRest
 */
/**
 * @typedef {Object} Context
 *   @property {import("@actions/core")} core
 *   @property {GitHubRest} githubRest
 *   @property {String} owner
 *   @property {String} repo
 */

if (require.main === module) {
  const githubRest = github.getOctokit(core.getInput('github_token', { required: true })).rest;
  main({ ctx: { core, githubRest, owner: github.context.repo.owner, repo: github.context.repo.repo } }).catch();
}

/**
 * @param {Context} ctx
 */
async function main({ ctx }) {
  const { core, githubRest, owner, repo } = ctx;
  try {
    let prSourceBranch = core.getInput('pr_source_branch', { required: true });

    // the head of a PR can come from another user/org, in which caste the format is org:branch,
    // but if the org:branch format is not used we assume the branch is in the current org
    if (!prSourceBranch.includes(':')) {
      prSourceBranch = `${owner}:${prSourceBranch}`;
    }

    const prDestinationBranch = core.getInput('pr_destination_branch', { required: true });

    const {
      data: [existingPr],
    } = await githubRest.pulls.list({
      owner,
      repo,
      base: prDestinationBranch,
      head: prSourceBranch,
    });

    if (existingPr) {
      await updatePr({ ctx, existingPr });
    } else {
      await createPr({ ctx, prSourceBranch, prDestinationBranch });
    }
  } catch (error) {
    core.error(error);
    core.setFailed(error.message);
    process.exit(1);
  }
}

/**
 * Creates a PR according to the configuration given to this Action.
 *
 * @param {Context} ctx
 * @param {string} prSourceBranch
 * @param {string} prDestinationBranch
 */
async function createPr({ ctx, prSourceBranch, prDestinationBranch }) {
  const { core, githubRest, owner, repo } = ctx;

  const title = core.getInput('create_pr_title', { required: true });
  const draft = core.getInput('create_pr_draft') === 'true';

  let body = core.getInput('create_pr_body') || '';
  if (!body) {
    const templateFile = core.getInput('create_pr_template_file') || '.github/pull_request_template.md';
    try {
      body = fs.readFileSync(templateFile).toString();
    } catch (error) {
      // error when reading .github/pull_request_template.md is to be expected if
      // the repository doesn't use a base pull request template. Otherwise, bad
      // parameter value given for template_file
      if (templateFile !== '.github/pull_request_template.md') {
        core.error(error);
        throw Error(`Error reading the given create_pr_template_file ${templateFile}`);
      }
    }
  }

  const templateVars = JSON.parse(core.getInput('create_pr_body_template_vars') || '{}');
  body = buildBodyFromTemplate({ ctx, template: body, templateVars });

  const { data: prJustCreated } = await githubRest.pulls.create({
    owner,
    repo,
    base: prDestinationBranch,
    head: prSourceBranch,
    title,
    body,
    draft,
  });

  await addPrReviewers({
    ctx,
    existingPr: prJustCreated,
    reviewersToAddCsv: core.getInput('create_pr_reviewers'),
  });

  core.setOutput('pr_created', 'true');
  core.setOutput('pr_url', prJustCreated.html_url);
  core.setOutput('pr_number', `${prJustCreated.number}`);
}

/**
 * Updates a PR according to the configuration given to this Action.
 *
 * @param {Context} ctx
 * @param {object} existingPr
 */
async function updatePr({ ctx, existingPr }) {
  const { core, githubRest, owner, repo } = ctx;

  const title = core.getInput('update_pr_title') || existingPr.title;
  let body = core.getInput('update_pr_body') || existingPr.body || '';
  const templateVars = JSON.parse(core.getInput('update_pr_body_template_vars') || '{}');
  body = buildBodyFromTemplate({ ctx, template: body, templateVars });

  if ((title && title !== existingPr.title) || body !== existingPr.body) {
    core.info(`Updating PR #${existingPr.number}.`);
    await githubRest.pulls.update({ owner, repo, pull_number: existingPr.number, title, body });
  } else {
    core.info(`PR #${existingPr.number} is already up-to-date.`);
  }

  await addPrReviewers({
    ctx,
    existingPr,
    reviewersToAddCsv: core.getInput('update_pr_reviewers'),
    reviewersToReAddCsv: core.getInput('update_pr_rerequest_reviewers'),
  });

  core.setOutput('pr_created', 'false');
  core.setOutput('pr_url', existingPr.html_url);
  core.setOutput('pr_number', `${existingPr.number}`);
}

/**
 * Replaces markdown tags in the template with the value specified by the templateVars.
 *
 * @param {Context} ctx
 * @param {string} template
 * @param {object} templateVars
 * @returns {string}
 */
function buildBodyFromTemplate({ ctx, template, templateVars }) {
  const { core } = ctx;
  let body = template;

  for (let [k, v] of Object.entries(templateVars)) {
    const START_TAG = `<!-- ${k}_START -->`;
    const END_TAG = `<!-- ${k}_END -->`;

    const startTagIndex = body.indexOf(START_TAG);
    const endTagIndex = body.indexOf(END_TAG);

    if (startTagIndex === -1) {
      core.warning(`Template did not include ${START_TAG}, no spot for the value given in template vars`);
      continue;
    }
    if (endTagIndex === -1) {
      core.warning(`Template did not include ${END_TAG}, no spot for the value given in template vars`);
      continue;
    }

    if (!v.startsWith(START_TAG)) {
      v = `${START_TAG}\n${v}`;
    }
    if (!v.endsWith(END_TAG)) {
      v = `${v}\n${END_TAG}`;
    }

    body = body.slice(0, startTagIndex) + v + body.slice(endTagIndex + END_TAG.length);
  }

  return body;
}

/**
 * Adds any reviewers listed in reviewersToAddCsv which are not already reviewers as reviewers of the PR.
 *
 * @param {Context} ctx
 * @param {object} existingPr
 * @param {string} reviewersToAddCsv
 * @param {string} [reviewersToReAddCsv]
 */
async function addPrReviewers({ ctx, existingPr, reviewersToAddCsv, reviewersToReAddCsv }) {
  const { core, githubRest, owner, repo } = ctx;

  const requestedReviewers = new Set(existingPr.requested_reviewers.map(reviewer => reviewer.login));
  const alreadyReviewedReviewers = new Set();

  let page = 1;
  const per_page = 15;
  while (true) {
    core.info(`Requesting page ${page} of pr reviews for PR #${existingPr.number}`);

    // after a review has been requested and given, that user is no longer listed as in the PR's requested_reviewers,
    // but we don't necessarily want to re-request reviews from them.
    const { data: reviews } = await githubRest.pulls.listReviews({ owner, repo, pull_number: existingPr.number });
    for (const review of reviews) {
      if (review.user && review.user.login) {
        alreadyReviewedReviewers.add(review.user.login);
      }
    }

    if (reviews.length < per_page) {
      break;
    }
    page++;
  }

  const prReviewersToRequest = new Set();

  if (reviewersToAddCsv) {
    for (const reviewer of reviewersToAddCsv.split(',')) {
      if (!requestedReviewers.has(reviewer) && !alreadyReviewedReviewers.has(reviewer)) {
        prReviewersToRequest.add(reviewer.trim());
      }
    }
  }

  if (reviewersToReAddCsv) {
    for (const reviewer of reviewersToReAddCsv.split(',')) {
      if (!requestedReviewers.has(reviewer)) {
        prReviewersToRequest.add(reviewer.trim());
      }
    }
  }

  if (prReviewersToRequest.size === 0) {
    core.info('No additional reviewers to add.');
    return;
  }

  core.info(`Adding reviewers to PR #${existingPr.number}: ${[...prReviewersToRequest].join(', ')}`);
  await githubRest.pulls.requestReviewers({
    owner,
    repo,
    pull_number: existingPr.number,
    reviewers: [...prReviewersToRequest],
  });
}
