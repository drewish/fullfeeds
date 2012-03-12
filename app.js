/**
 * Module dependencies.
 */

var express = require('express')
   , routes = require('./routes')
   , async = require('async')
   , redis = require('redis')
   , redisStore = require('connect-redis')(express);

var app = module.exports = express.createServer()
   , redisClient = redis.createClient();

// var feeds = [
//   {
//     name: 'plumline',
//     url: 'http://feeds.washingtonpost.com/rss/rss_plum-line',
//     urlExtractor: function(article) {
//       // Skip ads.
//       return (article.link.indexOf("ads.pheedo.com") === -1) ? article.guid : false;
//     },
//     selector: '#entrytext',
//   },
//   {
//     name: 'taibbi',
//     url: 'http://www.rollingstone.com/siteServices/rss/taibbiBlog',
//     selector: '.blog-post-content'
//   },
//   {
//     name: 'paulgraham',
//     url: 'http://www.aaronsw.com/2002/feeds/pgessays.rss',
//     selector: 'table table tr td'
//   }
// ];


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

// Routes

/**
 * Load the feed.
 */
app.param('feed', function(req, res, next, id){
  redisClient.hgetall('feed_info:' + id, function (err, obj) {
    if (err) {
      return next(err);
    }
    if (obj === null || obj === {}) {
      return next(new Error('cannot load feed ' + id));
    }
    req.feed = obj;
    next()
  });
});


app.get('/feeds', function(req, res){
  // Fetch the feeds list…
  redisClient.smembers('feed_list', function (err, obj) {
    if (err) return;
    // …then fetch the feeds…
    var multi = redisClient.multi();
    obj.forEach(function(key) {
      multi.hgetall('feed_info:' + key);
    });
    multi.exec(function (err, obj) {
      res.render('index', {
        title: 'Full Feeds',
        locals: { feeds: obj}
      });
    });
  });
});

app.get('/feeds/new', function(req, res){
console.log("new get");
console.dir(req.query.url);
  res.render('feed/add', {
    title: 'Add Feed', locals: {
      feed: {
        'url': req.body.url || req.query.url || '',
        'name': req.body.name,
        'selector': req.body.selector,
      }
    }
  });
});
app.post('/feeds/new', function(req, res){
console.log("new post");
console.dir(req.body);
  saveFeed(req.body.name, req.body.url, req.body.selector);
//console.dir(req.body.url);
  res.redirect('/feeds');
});

app.get('/feeds/:feed', function(req, res){
  var feed = req.feed;

  // For shits lets just render the feed.
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
      },
      function(callback) {
        // We don't really need to wait for this before we serve the page.
        buildFullFeed(feed, function(err, feedOut) {
          redisClient.setex('full_feed:' + feed.name, 60 * 60, feedOut.xml());
        });
        callback();
      }
    ],
    function(err) {
      res.render('feed/view', {
        title: 'View Feed',
        locals: { feed: feed}
      });
    }
  );
});

app.get('/feeds/:feed/edit', function(req, res){
console.log("editing");
  res.render('feed/edit', {
    title: 'Edit Feed',
    locals: { feed: req.feed}
  });
});
app.post('/feeds/:feed/edit', function(req, res){
console.log("updating");
  saveFeed(req.params.feed, req.body.url, req.body.selector);
  res.redirect('/feeds');
});

app.get('/feeds/:feed/delete', function(req, res){
console.log(req.feed);
  res.render('feed/delete', {
    title: 'Delete Feed',
    locals: { feed: req.feed}
  });
});
app.post('/feeds/:feed/delete', function(req, res){
  deleteFeed(req.params.feed);
  res.redirect('/feeds');
});

app.listen(3000);
console.log("Express server listening on port %d in %s mode", app.address().port, app.settings.env);

// function requiresLogin(req, res, next) {
//   if (req.session.user) {
//     next();
//   }
//   else {
//     res.redirect('/sessions/new?redirect=' + req.url);
//   }
// }

function saveFeed(name, url, selector) {
console.log("saving " + name);
  redisClient.multi()
    .sadd('feed_list', name, redis.print)
    .hmset('feed_info:' + name, {
      'name': name,
      'url': url,
      'selector': selector
    })
    .exec();
}

function deleteFeed(name) {
  redisClient.multi()
    .del('feed_info:' + name)
    .srem('feed_list', name)
    .exec();
}

function cachingFetcher(url, options, callback) {
  var request = require('request')
    , options = options || {}
    , key = (options.prefix || "raw_get:") + url
    , ttl = (options.ttl || 60 * 60 * 24 * 7);

  if (!url) {
    return callback(null, null);
  }

  // Try to load a cached copy...
  redisClient.get(key, function (err, result) {
    if (result !== null) {
      return callback(err, result);
    }
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
  });
};

function fetchFeed(feed, callback) {
  var FeedParser = require('feedparser');
  cachingFetcher(feed.url, {ttl: 60 * 60}, function (err, result) {
    (new FeedParser()).parseString(result, function(err, meta, articles) {
      feed.meta = meta;
      feed.articles = articles;
      callback(err, feed);
    });
  });
}

function fetchFeedsArticles(feed, callback) {
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
    console.log(article.html.substr(0, 100));
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
