/**
 * Module dependencies.
 */

var util = require('util')
  , express = require('express')
  , routes = require('./routes')
  , async = require('async')
  , redis = require('redis')
  , redisStore = require('connect-redis')(express)
  , moment = require('moment');

var app = module.exports = express.createServer()
  , redisClient = redis.createClient();

// Configuration

app.configure(function(){
  app.set('views', __dirname + '/views');
  app.set('view engine', 'jade');
  app.use(express.bodyParser());
  app.use(express.methodOverride());
  app.use(express.cookieParser());
  app.use(express.session({
    store: new redisStore({client: redisClient}),
    secret: 'some secret here'
  }));
  app.use(app.router);
  app.use(express.static(__dirname + '/public'));
});

app.configure('development', function(){
  app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
});

app.configure('production', function(){
  app.use(express.errorHandler());
});

/**
 * Load the feed.
 */
app.param('feed', function(req, res, next, id){
  loadFeed(id, function(err, feed) {
    if (err) {
      return next(err);
    }
    if (!feed) {
      return next(new Error('Cannot load feed ' + id));
    }
    req.feed = feed;
    next();
  });
});

app.dynamicHelpers({ messages: require('express-messages-bootstrap') });

app.dynamicHelpers({ moment: function(req, res) {
  return moment;
}});

// Routes

app.get('/feeds', function(req, res){
  // Fetch the feeds list…
  loadAllFeeds(function (err, obj) {
    res.render('index', {
      title: 'Full Feeds',
      locals: { feeds: obj}
    });
  });
});

app.get('/feeds/new', function(req, res){
  var feed = req.body.feed || req.query.feed || {};
  res.render('feed/add', {
    title: 'New Feed',
    locals: { feed: feed }
  });
});
app.post('/feeds/new', function(req, res){
  // TODO: need to try fetching feed and return errors if not.
  var feed = req.body.feed
  fetchFeed(feed, function(err, feed) {
    if (!err) {
      // Queue the article fetching but don't wait for it to finish.
      fetchFeedsArticles(feed);
      saveFeed(feed);
      req.flash('info', 'Created the feed');
      res.redirect('/feeds');
    }
  });
});

app.get('/feeds/:feed', function(req, res){
  var feed = req.feed;

  updateFeed(feed, function(err) {
    if (err) return;
    res.render('feed/view', {
      title: feed.meta.title,
      locals: { feed: feed, updated: moment(feed.fetchedAt).fromNow() }
    });
  });
});

app.get('/feeds/:feed/xml', function(req, res){
  buildFullFeed(req.feed, function(err, feedOut) {
    res.header('Content-Type', 'application/rss+xml; charset=utf-8');
    res.end(feedOut.xml());
  });
});

app.get('/feeds/:feed/refresh', function(req, res){
  updateFeed(req.feed);
  req.flash('info', 'Refreshing the feed');
  // TODO: should be smarter on where we redirect them to.
  res.redirect('/feeds');
});


app.get('/feeds/:feed/edit', function(req, res){
console.log("editing");
  res.render('feed/edit', {
    title: (req.feed.meta || {title:''}).title,
    locals: { feed: req.feed}
  });
});
app.post('/feeds/:feed/edit', function(req, res){
  var feed = req.body.feed
  feed.selector = req.params.feed.selector;
console.log(feed);
  saveFeed(feed);
  req.flash('info', 'Saved the feed');
  res.redirect('/feeds');
});

app.get('/feeds/:feed/delete', function(req, res){
  res.render('feed/delete', {
    title: (req.feed.meta || {title:''}).title,
    locals: { feed: req.feed}
  });
});
app.post('/feeds/:feed/delete', function(req, res){
  deleteFeed(req.params.feed);
  req.flash('info', 'Deleted the feed');
  res.redirect('/feeds');
});

app.listen(3000);
console.log("Express server listening on port %d in %s mode", app.address().port, app.settings.env);

function hashUrl(url) {
  var crypto = require('crypto')
    , hash = crypto.createHash('md5');
  hash.update(url);
  return hash.digest('hex');
}

function saveFeed(feed) {
  if (!feed.url) {
    return false;
  }
  feed.name = feed.name || hashUrl(feed.url);

  redisClient.hmset('feed_info', feed.name, JSON.stringify(feed), redis.print);
}

function _parseFeed(json) {
  var feed = JSON.parse(json);
  feed.meta = feed.meta || {'title': 'Missing Title'};
  feed.articles = feed.articles || [];
  feed.fetchedAt = feed.fetchedAt || null;
  return feed;
}

function loadFeed(name, fn) {
  redisClient.hget('feed_info', name, function (err, obj) {
    if (err) {
      return fn(err);
    }
    try {
      obj = _parseFeed(obj);
    }
    catch (SyntaxError) {
      return fn(SyntaxError);
    }
    return fn(null, obj);
  });
}

function loadAllFeeds(fn) {
  redisClient.hgetall('feed_info', function (err, obj) {
    if (err) {
      return fn(err);
    }
    Object.keys(obj).forEach(function(key) {
      // Ignore problems with individual feeds.
      try {
        obj[key] = _parseFeed(obj[key]);
      }
      catch (SyntaxError) { }
    });
    fn(null, obj);
  });
}

function deleteFeed(name) {
  redisClient.hdel('feed_info', name);
}

function cachingFetcher(url, options, callback) {
  var request = require('request')
    , options = options || {}
    , key = (options.prefix || "raw_get:") + url
    , ttl = (options.ttl || 60 * 60 * 24 * 7)
    , skipCache = (options.skipCache || false);

  if (!url) {
    return callback(null, null);
  }

  var fetcher = function() {
    console.log("Fetching %s", url);
    request.get(url, function (err, response, body) {
      // If it was successful cache a copy with redis.
      if (response.statusCode >= 200 && response.statusCode < 300){
        redisClient.setex(key, ttl, body);
        return callback(err, body);
      }
      else {
        return callback(err, null);
      }
    });
  }

  if (skipCache) {
    fetcher();
  }
  else {
    // Try to load a cached copy...
    redisClient.get(key, function (err, result) {
      if (result !== null) {
        return callback(err, result);
      }
      fetcher()
    });
  }
};

function fetchFeed(feed, callback) {
  var FeedParser = require('feedparser');
  try {
    (new FeedParser()).parseFile(feed.url, function(err, meta, articles) {
      feed.meta = meta;
      feed.articles = articles;
      feed.fetchedAt = (new Date()).toJSON();
      console.log(feed.fetchedAt);
      callback(err, feed);
    });
  }
  catch (err) {
    callback(err)
  }
}

function fetchFeedsArticles(feed, callback) {
  // Might be good to have some locking here so we don't try to reload the
  // same articles multiple times.
  var urlExtractor = feed.urlExtractor || function(a) { return a.link; }
    , articles = []
    , tasks = [];

  // Build an array of the article URLs. We'll skip over false values.
  feed.articles.forEach(function (article) {
    if (article.url = urlExtractor(article)) {
      tasks.push(function(fetchCallback) {
        cachingFetcher(article.url, {}, function (err, body) {
          if (!err) {
            article.html = body;
          }
          fetchCallback(err);
        });
      });
      articles.push(article);
    }
  });
  // Only leave the legit ones in there.
  feed.articles = articles;

  console.log("%s: Found %d items", feed.name, feed.articles.length);
  async.parallel(tasks, callback);
}

function extractArticle(feed, article, callback) {
  // Try to fetch the linked article and extract its content.
  var jsdom = require('jsdom')
    , key = "parsed:article:" + article.url;

  // Try to load a cached copy.
  redisClient.get(key, function (err, res) {
    if (res !== null) {
      article.content = res;
      return callback();
    }
    console.log("%s: Fetching %s", feed.name, article.url);
    // Have JSDOM parse it...
    jsdom.env(
      article.html,
      function(errors, window) {
        // jsdom has a customized version of sizzle that we can use.
        var Sizzle = require("jsdom/example/sizzle/sizzle").sizzleInit(window, window.document),
            matches = Sizzle(feed.selector);
            article.content = null;
        if (matches.length > 0) {
          article.content = matches[0].innerHTML;
          // ...and store a cached copy for a week.
          redisClient.setex(key, 60 * 60 * 24 * 7, article.content);
        }

        // Release the memory.
        window.close();

        return callback(errors);
      }
    );
  });
}

function extractFeedsArticles(feed, callback) {
  async.forEachSeries(
    feed.articles,
    function(a, eachCallback) { extractArticle(feed, a, eachCallback); },
    callback
  );
}

function buildFullFeed(feed, callback) {
  console.log("%s: Building feed", feed.name);
  var rss = require('rss')
    , feedOut = new rss({
        title: feed.meta.title,
        description: feed.meta.description,
        site_url: feed.meta.link,
        feed_url: feed.url,
      });

  feed.articles.forEach(function(article) {
    feedOut.item({
      title: article.title,
      url: article.link,
      guid: article.guid,
      date: article.pubDate,
      description: article.content
    });
  });
  callback(null, feedOut);
}

// Update the feeds once an hour.
setInterval(updateFeeds, 1000 * 60 * 60);

function updateFeeds() {
  loadAllFeeds(function (err, feeds) {
    Object.keys(feeds).forEach(function(name) {
      updateFeed(feeds[name]);
    });
  });
}

function updateFeed(feed, fn) {
  console.log("updating feed " + feed.name);
  fn = fn || function() {};
  async.series(
    [
      function(callback) {
        fetchFeed(feed, callback);
      },
      function(callback) {
        fetchFeedsArticles(feed, callback);
      },
      function(callback) {
        extractFeedsArticles(feed, callback);
      // },
      // function(callback) {
      //   // We don't really need to wait for this before we serve the page.
      //   buildFullFeed(feed, function(err, feedOut) {
      //     redisClient.setex('full_feed:' + feed.name, 60 * 60, feedOut.xml());
      //   });
      //   callback();
      }
    ],
    function(err) {
      if (!err) {
        saveFeed(feed);
      }
      fn(err, feed);
    }
  );
};