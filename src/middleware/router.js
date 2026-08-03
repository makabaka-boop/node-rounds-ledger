'use strict';

/**
 * 极简路由器：支持基于正则的路径参数匹配，方法 + 路径注册。
 * 每个 handler 形如 async (ctx) => result，ctx = { req, res, params, query, body }.
 */
class Router {
  constructor(prefix = '') {
    this.prefix = prefix;
    this.routes = [];
  }

  add(method, pattern, handler) {
    const { regex, keys } = compile(this.prefix + pattern);
    this.routes.push({ method, regex, keys, handler });
    return this;
  }

  get(p, h) { return this.add('GET', p, h); }
  post(p, h) { return this.add('POST', p, h); }
  patch(p, h) { return this.add('PATCH', p, h); }
  put(p, h) { return this.add('PUT', p, h); }
  delete(p, h) { return this.add('DELETE', p, h); }

  match(method, pathname) {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const m = route.regex.exec(pathname);
      if (m) {
        const params = {};
        route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        return { handler: route.handler, params };
      }
    }
    return null;
  }
}

// 把 "/devices/:id/rounds" 编译成正则并抽取参数名
function compile(pattern) {
  const keys = [];
  const regexStr = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === ':' ? c : `\\${c}`))
    .replace(/:([A-Za-z0-9_]+)/g, (_, key) => {
      keys.push(key);
      return '([^/]+)';
    });
  return { regex: new RegExp(`^${regexStr}/?$`), keys };
}

module.exports = { Router };
