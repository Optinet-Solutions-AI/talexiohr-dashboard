import { describe, it, expect, afterEach } from 'vitest'
import { graphqlUrl } from '../url'

const KEY = 'NEXT_PUBLIC_TALEXIOHR_API_URL'
const original = process.env[KEY]

afterEach(() => {
  if (original === undefined) delete process.env[KEY]
  else process.env[KEY] = original
})

describe('graphqlUrl', () => {
  it('appends /graphql to a bare host (the bug we hit)', () => {
    process.env[KEY] = 'https://client-api.talexiohr.com/'
    expect(graphqlUrl()).toBe('https://client-api.talexiohr.com/graphql')
  })

  it('appends /graphql to a host with no trailing slash', () => {
    process.env[KEY] = 'https://client-api.talexiohr.com'
    expect(graphqlUrl()).toBe('https://client-api.talexiohr.com/graphql')
  })

  it('leaves a correct /graphql URL unchanged', () => {
    process.env[KEY] = 'https://api.talexiohr.com/graphql'
    expect(graphqlUrl()).toBe('https://api.talexiohr.com/graphql')
  })

  it('normalizes a /graphql URL with a trailing slash', () => {
    process.env[KEY] = 'https://api.talexiohr.com/graphql/'
    expect(graphqlUrl()).toBe('https://api.talexiohr.com/graphql')
  })

  it('falls back to the api.talexiohr.com endpoint when env is unset', () => {
    delete process.env[KEY]
    expect(graphqlUrl()).toBe('https://api.talexiohr.com/graphql')
  })
})
