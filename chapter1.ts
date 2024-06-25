/**
 * Chapter 1 was tried to build one function voting from other web browser like Stack overflow, Reddit,...
 * We use Redis to solve the problem
 */

/**
 * First, store info article ===> use HASH
 * Example:
 * poster: creator of article
 * time: the time created
 * votes: users upvoted for article
 * --- article:92617 ------------------------------------ hash -----
 * |---------------------------------------------------------------|
 * |  title            |  Hey, this is new idea to solve problem   |
 * |                   |     use Redis                             |
 * |  link             |  http://goo.gl/kZUSu                      |
 * |  poster           |  user:83271                               |
 * |  time             |  1331382699.33                            |
 * |  votes            |  528                                      |
 * |---------------------------------------------------------------|
 */

/**
 * Second, in order to sorted score: and time: ==> use ZSET in redis
 * --- time:  ------------------ zset -----
 * | article:100408   |   1332065417.47   |
 * | article:100635   |   1332075503.49   |
 * | article:100716   |   1332082035.26   |
 * |--------------------------------------|
 *
 * --- score:  ----------------- zset -----
 * | article:100635   |   1332164063.49   |
 * | article:100408   |   1332174713.47   |
 * | article:100716   |   1332225027.26   |
 * |--------------------------------------|
 */

/**
 * Third, we need to prevent users from voting for the same article more than once ==> we need
 * store a unique lsiting of users who have voted for each article ===> use SET in redis
 * Example:
 * --- voted:100408  -------- set -----
 * | user:234487                      |
 * | user:253378                      |
 * | user:364680                      |
 * | user:132097                      |
 * | user:350917                      |
 * | ....                             |
 * |----------------------------------|
 */

const ONE_WEEK_IN_SECONDS = 7 * 86400;
const VOTE_SCORE = 342;

/**
 * @summary article is voted by user
 * @param conn connect to redis server
 * @param user info of user voting
 * @param article example: article:100635 --> string identifier article + ID of article
 */
function article_vote(conn: any, user: any, article: string) {
  const cutoff: number = Date.now() / 1000 - ONE_WEEK_IN_SECONDS;

  if (conn.zscore('time:', article) < cutoff) {
    return;
  }

  const article_id: string = article.split(':')[1];
  if (conn.add('voted:' + article_id, user)) {
    conn.zincrby('score:', article, VOTE_SCORE);
    conn.hincrby(article, 'votes', 1);
  }
}

/**
 * @summary article is down voted by user
 * @param conn connect to redis server
 * @param user for instance: user:253378
 * @param article article id
 */
function article_down_vote(conn: any, user: any, article: string) {
  const cutoff: number = Date.now() / 1000 - ONE_WEEK_IN_SECONDS;

  if (conn.zscore('time:', article) < cutoff) {
    return;
  }

  const article_id: string = article.split(':')[1];

  if (conn.srem('voted:' + article_id, user)) {
    const votes: number = conn.hget('article:' + article_id, 'votes');
    const score: number = conn.zscore('score:', `article:${article_id}`);

    conn.hset('article:' + article_id, 'votes', votes - 1);
    conn.zadd('score:', `article:${article_id}`, score - 432);
  }
}

/**
 * @summary create new article with one vote initialized
 * @param conn connect to redis server
 * @param user identifier of user. For instance, like "user:253378"
 * @param title title of article
 * @param link the url to navigate the article
 */
function post_article(conn: any, user: any, title: string, link: string) {
  // Generate a new article id
  const article_id: string = conn.incr('article:') as string;

  const voted: string = 'voted:' + article_id;
  conn.sadd(voted, user);
  conn.expire(voted, ONE_WEEK_IN_SECONDS);

  const now = Date.now() / 1000;
  const article = 'article:' + article_id;

  conn.hmset(article, {
    ['title']: title,
    ['link']: link,
    ['poster']: user,
    ['time']: now,
    ['votes']: 1,
  });

  conn.zadd('score:', article, now + VOTE_SCORE);
  conn.zadd('time:', article, now);

  return article_id;
}

/**
 * @summary fetching the current top-scoring or most recent articles
 * @param conn connect to redis server
 * @param page for pagination
 * @param order get following by top most score or top most recent article
 */
const ARTICLES_PER_PAGE = 25;
function get_articles(conn: any, page: number, order: string = 'score:') {
  const start: number = (page - 1) * ARTICLES_PER_PAGE;
  const end: number = start + ARTICLES_PER_PAGE - 1;

  const ids = conn.zrevrange(order, start, end);
  const articles: any = [];

  for (let id in ids) {
    const article_data = conn.hgetall(id);

    article_data['id'] = id;
    articles.push(article_data);
  }

  return articles;
}

/**
 * We will use SET in redis for store information in group, which stores the
 * article IDs of all articles in that group.
 */

/**
 * @summary Grouping articles
 * @param conn connect to redis server
 * @param article_id article_id of article
 * @param to_add array of group id which is used to add article
 * @param to_remove array of group id which is used to remove article
 */
function add_remove_groups(
  conn: any,
  article_id: string,
  to_add: any[] = [],
  to_remove: any[] = [],
) {
  const article: string = 'article:' + article_id;

  for (let group in to_add) {
    conn.sadd('group:' + group, article);
  }

  for (let group in to_remove) {
    conn.srem('group:' + group, article);
  }
}

/**
 * @summary Get articles in one group and pagination it follow score or time
 * @param conn connect to redis server
 * @param group group_id
 * @param page for pagination
 * @param order optional choice for score or time
 */
function get_group_articles(
  conn: any,
  group: string,
  page: number,
  order: string = 'score:',
) {
  const key: string = order + group;

  if (!conn.exists(key)) {
    conn.zinterstore(key, ['group:' + group, order], (aggregate = 'max'));
    conn.expire(key, 60);
  }

  return get_articles(conn, page, key);
}
