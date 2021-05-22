const app = require('./express')
const serverlessExpress = require('@vendia/serverless-express')

exports.handler = serverlessExpress({app})
