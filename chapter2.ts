/**
 * @param conn connection to redis
 * @param token random string (session based cookie)
 * @returns user info if exists
 */
function check_token(conn: any, token: string) {
  return conn.hget('login:', token);
}

/**
 *
 * @param conn connection to redis
 * @param token random string (session based cookie)
 * @param user user info
 * @param item item was viewed when shopping
 */
function update_token(conn: any, token: string, user: any, item: any = null) {
  const timestamp = Date.now();

  conn.hset('login:', token, user);
  conn.zadd('recent:', token, timestamp);

  if (item) {
    conn.zadd('viewed:' + token, item, timestamp);
    conn.zremrangebyrank('viewed:' + token, 0, -26);
    conn.zincrby('viewed:', item, -1);
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const QUIT: boolean = false;
const LIMIT: number = 10000000;
async function clean_full_sessions(conn: any) {
  while (!QUIT) {
    const size: number = conn.zcard('recent:');
    if (size <= LIMIT) {
      await sleep(1000);
      continue;
    }

    const end_index: number = Math.min(size - LIMIT, 100);
    const sessions = conn.zrange('recent:', 0, end_index - 1);

    for (let session of sessions) {
      conn.delete('cart:' + session);
      conn.delete('viewed:' + session);
      conn.hdel('login:', session);
      conn.zrem('recent:', session);
    }
  }
}

async function add_to_cart(
  conn: any,
  session: string,
  item: any,
  count: number,
) {
  if (count <= 0) {
    conn.hdel('cart:' + session, item);
  } else {
    conn.hset('cart:' + session, item, count);
  }
}

async function cache_request(conn: any, request: Request, callback: any) {
  if (!can_cache(conn, request)) {
    return callback(request);
  }

  const page_key: string = 'cache:' + hash_request(request);
  const content = conn.get(page_key);

  if (!content) {
    content = callback(request);
    conn.setex(page_key, content, 300);
  }

  return content;
}

async function schedule_row_cache(conn: any, row_id: number, delay: number) {
  conn.zadd('delay:', row_id, delay);
  conn.zadd('schedule:', row_id, Date.now());
}

async function cache_rows(conn: any) {
  while (!QUIT) {
    const next = conn.zrange('schedule:', 0, 0, (withscores = true));
    const now = Date.now();

    if (!next || next[0][1] > now) {
      await sleep(50);
      continue;
    }

    const row_id = next[0][0];
    const delay = conn.zscore('delay:', row_id);

    if (delay <= 0) {
      conn.zrem('delay:', row_id);
      conn.zrem('schedule:', row_id);
      conn.delete('inv:' + row_id);
      continue;
    }

    const row = Inventory.get(row_id); // lay row ra roi chuyen thanh dang object chu meo co gi =))
    conn.zadd('schedule:', row_id, now + delay);
    conn.set('inv:' + row_id, JSON.stringify(row));
  }
}

async function resclae_viewed(conn: any) {
  while (!QUIT) {
    conn.zremrangebyrank('viewed:', 20000, -1);
    conn.zinterstore('viewed:', { 'viewed:': 0.5 });
    await sleep(300 * 1000);
  }
}

async function can_cache(conn: any, request: any) {
  const item_id = extract_time_id(request);
  if (!item_id || is_dynamic(request)) {
    return false;
  }

  const rank = conn.zrank('viewed:', item_id);
  return rank !== null && rank < 10000;
}
