'use strict'

const { test } = require('tap')
const Fastify = require('fastify')
const GQL = require('../..')

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function buildService (schema) {
  const app = Fastify()

  const resolvers = {
    Query: {
      me: () => {
        return {
          id: 1,
          name: 'John',
          username: '@john'
        }
      }
    }
  }

  app.register(GQL, {
    schema,
    resolvers,
    federationMetadata: true,
    allowBatchedQueries: true
  })

  return app
}

async function buildProxy (nodePort1) {
  const proxy = Fastify()

  proxy.register(GQL, {
    graphiql: true,
    gateway: {
      services: [
        {
          name: 'ext1',
          url: `http://localhost:${nodePort1}/graphql`
        }
      ]
    },
    pollingInterval: 1000
  })

  return proxy
}

test('federated node should be updated when it restarts', async (t) => {
  const schemaV1 = `
    extend type Query {
      me: User
    }

    type User @key(fields: "id") {
      id: ID!
      name: String
      username: String
    }
  `

  const nodePort = 3027
  let node = await buildService(schemaV1)
  await node.listen(nodePort)
  t.teardown(() => { node.close() })

  const serviceProxy = await buildProxy(nodePort)
  await serviceProxy.ready()
  t.teardown(() => { serviceProxy.close() })

  {
    const res = await serviceProxy.inject({
      method: 'POST',
      url: '/graphql',
      body: {
        query: `{
          me { ...UserFields }
        }
        
        fragment UserFields on User {
          id name username
        }`
      }
    })

    t.same(res.json(), {
      data: {
        me: {
          id: '1',
          name: 'John',
          username: '@john'
        }
      }
    })
  }

  // Update schema
  const schemaV2 = `
    extend type Query {
      me: UserFoo
    }

    type UserFoo @key(fields: "id") {
      id: ID!
      name: String
      username: String
    }
  `

  await node.close()
  node = await buildService(schemaV2)
  await node.listen(nodePort)

  await sleep(3000)

  {
    const res = await serviceProxy.inject({
      method: 'POST',
      url: '/graphql',
      body: {
        query: `{
          me { ...UserFields }
        }
        
        fragment UserFields on UserFoo {
          id name username
        }`
      }
    })

    t.same(res.json(), {
      data: {
        me: {
          id: '1',
          name: 'John',
          username: '@john'
        }
      }
    })
  }
})
