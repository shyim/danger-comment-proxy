const express = require('express')
const bodyParser = require('body-parser')
const {HttpClient} = require('@actions/http-client')
const {ErrorHandler, BadRequestError} = require('express-json-api-error-handler')

const getCommentIds = async (http, params) => {
  const {repoToken, owner, repo, issueNumber} = params

  const comments = await http.getJson(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
    {
      accept: 'application/vnd.github.v3+json',
      authorization: `token ${repoToken}`,
    }
  )

  const ids = []

  for (const comment of comments.result) {
    if (comment.body.indexOf('<!--- Danger-PHP-Marker -->') !== -1) {
      ids.push(comment.id)
    }
  }

  return ids
}

const createComment = async (http, params) => {
  const {repoToken, owner, repo, issueNumber, body} = params

  return http.postJson(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
    {body},
    {
      accept: 'application/vnd.github.v3+json',
      authorization: `token ${repoToken}`,
    }
  )
}

const checkToken = async (http, token) => {
  if (!token) {
    return false
  }

  if (token === process.env.GITHUB_TOKEN) {
    // Assume the use of this token is intentional
    return true
  }

  try {
    await http.getJson(`https://api.github.com/user/repos`, {
      accept: 'application/vnd.github.v3+json',
      authorization: `token ${token}`,
    })
    return false
  } catch (err) {
    // Far from perfect, temporary tokens are difficult to identify
    // A bad token returns 401, and a personal token returns 200
    return (
      err.statusCode === 403 &&
      err.result.message &&
      err.result.message.startsWith('Resource not accessible by integration')
    )
  }
}

const app = express()

app.use((req, res, next) => {
  req.httpClient = new HttpClient('http-client-add-pr-comment-bot')
  next()
})
app.use(bodyParser.json())

app.post('/repos/:owner/:repo/issues/:issueNumber/comments', async (req, res, next) => {
  try {
    const isTokenValid = await checkToken(req.httpClient, req.header('temporary-github-token'))
    if (!isTokenValid) {
      throw new BadRequestError('must provide a valid temporary github token')
    }

    const ids = await getCommentIds(req.httpClient, {
      ...req.params,
      repoToken: process.env.GITHUB_TOKEN,
    })

    let response

    if (req.body.body === 'delete') {
      for (const id of ids) {
        await req.httpClient.del(
          `https://api.github.com/repos/${req.params.owner}/${req.params.repo}/issues/comments/${id}`,
          {
            accept: 'application/vnd.github.v3+json',
            authorization: `token ${process.env.GITHUB_TOKEN}`,
          }
        )
      }

      res.status(200).send({}).end()
      return
    }

    if (req.body.mode === 'replace') {
      for (const id of ids) {
        await req.httpClient.del(
          `https://api.github.com/repos/${req.params.owner}/${req.params.repo}/issues/comments/${id}`,
          {
            accept: 'application/vnd.github.v3+json',
            authorization: `token ${process.env.GITHUB_TOKEN}`,
          }
        )
      }

      response = await createComment(req.httpClient, {
        ...req.params,
        ...req.body,
        repoToken: process.env.GITHUB_TOKEN,
      })
    } else {
      if (ids.length) {
        response = await req.httpClient.patchJson(
          `https://api.github.com/repos/${req.params.owner}/${req.params.repo}/issues/comments/${ids[0]}`,
          {body: req.body.body},
          {
            accept: 'application/vnd.github.v3+json',
            authorization: `token ${process.env.GITHUB_TOKEN}`,
          }
        )
      } else {
        response = await createComment(req.httpClient, {
          ...req.params,
          ...req.body,
          repoToken: process.env.GITHUB_TOKEN,
        })
      }
    }

    res.status(200).send(response.result).end()
  } catch (err) {
    next(err)
  }
})

// Must use last
const errorHandler = new ErrorHandler()
errorHandler.setErrorEventHandler(err => console.log(JSON.stringify(err)))
app.use(errorHandler.handle)

module.exports = app
