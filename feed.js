var async = require('async'),
    redis = require("redis"),
    client;

var feedInfo = function(feedName) {
  var wapoLink = function(article) {
    // Skip ads.
    if (article.link.indexOf("ads.pheedo.com") === -1) {
      return article.guid;
    }
    return false;
  };
  var feeds = {
    'plumline': {
      url: 'http://feeds.washingtonpost.com/rss/rss_plum-line',
      urlExtractor: wapoLink,
      selector: '#entrytext',
    },
    'ezraklein': {
      url: 'http://feeds.washingtonpost.com/rss/rss_ezra-klein',
      urlExtractor: wapoLink,
      selector: '#article_body'
    },
  };
  return feeds[feedName];
}

var itemFetcher = function (item, callback) {
  var request = require('request'),
      jsdom  = require('jsdom');

  var key = "fullfeed:article:" + item.url;

  // Try to load a cached copy.
  client.get(key, function (err, res) {
    if (res !== null) {
      item.body = res;
      callback(err, item);
    }
    else {
      console.log("%s Fetching article %s", item.feedName, item.url);
      // Have JSDOM fetch the page and parse it...
      jsdom.env(
        item.url,
        function(errors, window) {
          var Sizzle = require("jsdom/example/sizzle/sizzle").sizzleInit(window, window.document),
              selector = feedInfo(item.feedName).selector,
              matches = Sizzle(selector);
          if (matches.length > 0) {
            item.body = matches[0].innerHTML;
          }
          // ...and store a cached copy.
          client.setex(key, 60 * 60 * 24, item.body, redis.print);
          callback(errors, item);
          // // Add in jQuery...
          // jsdom.jQueryify(window, function() {
          //   // ...pull out the important bits...
          //   item.body = feedInfo(item.feedName).contentExtractor(window.$);
          //   // ...and store a cached copy.
          //   client.set(key, item.body, redis.print);
          //   callback(err, item);
          // });
        }
      );
    }
  });
}

var processFeed = function(feedName, finalCallback) {
  var FeedParser = require('feedparser'),
      RSS = require('rss');

  var feedUrl = feedInfo(feedName).url;

  async.auto({
    fetch_feed: function(callback) {
      // Fetch a feed, convert it to JSON and pass it to the callback.
      console.log("%s: Fetching (%s)", feedName, feedUrl);
      (new FeedParser()).parseUrl(feedUrl, function(err, meta, articles) {
        callback(err, {meta: meta, articles: articles});
      });
    },
    extract_urls: ['fetch_feed', function(callback, results) {
      // Build an array of the articles that have truthy URLs.
      var urlExtractor = feedInfo(feedName).urlExtractor,
          items = [];

      results.fetch_feed.articles.forEach(function (article) {
        var url = urlExtractor(article);
        if (url) {
          items.push({feedName: feedName, url: url, article: article});
        }
      });
      console.log("%s: Found %d items", feedName, items.length);
      callback(null, items);
    }],
    fetch_items: ['extract_urls', function(callback, results) {
      async.map(results.extract_urls, itemFetcher, callback);
    }],
    build_feed: ['fetch_items', function(callback, results) {
      console.log("%s: Building feed", feedName);
      // Build an array of the articles that have truthy URLs.
      var meta = results.fetch_feed.meta,
          feedOut = new RSS({
            // author: 'Dylan Greene',
            title: meta.title,
            description: meta.description,
            site_url: meta.link,
            feed_url: feedUrl,
            // image_url: 'http://example.com/icon.png',
          });

      results.fetch_items.forEach(function (item) {
        if (item.body) {
          feedOut.item({
            title: item.article.title,
            url: item.article.link,
            guid: item.article.guid,
            date: item.article.pubDate,
            description: item.body
          });
        }
      });

      callback(null, feedOut);
    }],
    save_feed: ['build_feed', function(callback, results) {
      var path = __dirname + '/public/' + feedName + '.xml';
      var fs = require('fs');
      console.log("%s: Saving to %s", feedName, path);
      fs.writeFile(path, results.build_feed.xml(), function(err) {
        callback(err, path);
      });
   }]
  }, finalCallback);
}

client = redis.createClient();
async.parallel([
  function(callback){ processFeed('plumline', callback); },
  function(callback){ processFeed('ezraklein', callback); }
], function(){ client.end(); });
