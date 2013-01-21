var async = require('async'),
    redis = require("redis"),
    jsdom  = require('jsdom'),
    FeedParser = require('feedparser'),
    RSS = require('rss');

/**
 * The feedConfig is a array of objects with the following keys:
 * - name: Key used for the results.
 * - url: RSS feed's URL
 * - selector: Sizzle selector of the DOM element to extract the content from.
 * - urlExtractor: Optional function that takes two params: an article and a
 *   callback. It passes a final URL or false to the callback. False results in
 *   the article being skipped.
 * The finalCallback gets called when all the feeds are updated.
 */
var processFeed = function(feedConfig, finalCallback) {
  defaultUrlExtractor = function (article, callback) {
    callback(null, article.link);
  };

  async.auto({
    // Bit of an artifical step to get the config in a constant place
    config: function(callback) {
      callback(null, feedConfig);
    },

    // Use feed parser to fetch a feed, convert it to JSON.
    fetch_feed: ['config', function(callback, results) {
      console.log("%s: Fetching (%s)", results.config.name, results.config.url);
      (new FeedParser()).parseUrl(results.config.url, function(err, meta, articles) {
        callback(err, {meta: meta, articles: articles});
      });
    }],

    // Build an array of the article URLs. We'll put false values in for now to
    // keep the arrays aligned and skip over them later.
    extract_urls: ['fetch_feed', function(callback, results) {
      // We need another layer of async here since some URL extraction requires
      // a second fetch.
      var urlExtractor = results.config.urlExtractor || defaultUrlExtractor;
      async.map(results.fetch_feed.articles, urlExtractor, function(err, items) {
        console.log("%s: Found %d items", results.config.name, items.length);
        callback(null, items);
      });
    }],

    // Try to fetch the linked article and extract its content.
    fetch_items: ['extract_urls', function(callback, results) {
      var itemFetcher = function (url, fetchedCallback) {
        var key = "fullfeed:article:" + url;

        // Bail if extract_urls set a false value for the feed, set a falue
        // value for this content.
        if (!url) {
          return fetchedCallback(null, false);
        }

        // Try to load a cached copy.
        client.get(key, function (err, res) {
          if (res !== null) {
            return fetchedCallback(err, res);
          }
          console.log("%s: Fetching %s", results.config.name, url);
          // Have JSDOM fetch the page and parse it...
          jsdom.env(
            url,
            function(errors, window) {
              // jsdom has a customized version of sizzle that we can use.
              var Sizzle = require("./sizzle").sizzleInit(window, window.document),
                  matches = Sizzle(results.config.selector);
                  content = 'selector did not match.';
              // If we found something...
              if (matches.length) {
                content = matches[0].innerHTML;
                // ...store a cached copy for a week.
                client.setex(key, 60 * 60 * 24 * 7, content);//, redis.print);
              }
              else {
                console.log("%s: Sizzle selector `%s` found no content.", results.config.name, results.config.selector);
              }

              // Release the memory.
              window.close();

              return fetchedCallback(errors, content);
            }
          );
        });
      };
      // Fetch the items then shutdown redis.
      var client = redis.createClient();
      async.map(results.extract_urls, itemFetcher, function(err, results) {
        client.end();
        callback(err, results);
      });
    }],

    // Generate a new feed with the full text of the articles.
    build_feed: ['fetch_items', function(callback, results) {
      console.log("%s: Building feed", results.config.name);
      var meta = results.fetch_feed.meta,
          feedOut = new RSS({
            // author: 'Dylan Greene',
            title: meta.title,
            description: meta.description,
            site_url: meta.link,
            feed_url: results.config.url,
            // image_url: 'http://example.com/icon.png',
          });

      // Loop over each article in the source feed.
      for (var i = 0; i < results.fetch_feed.articles.length; i++) {
        // The HTML in fetch_items should be at the same index as but articles
        // that were skipped for some reason will have a false value so skip
        // over those here too.
        if (results.fetch_items[i]) {
          var article = results.fetch_feed.articles[i];
          feedOut.item({
            title: article.title,
            url: article.link,
            guid: article.guid,
            date: article.pubDate,
            description: results.fetch_items[i]
          });
        }
      }

      callback(null, feedOut);
    }]
  }, finalCallback);
}

// For each config item build a feed.
module.exports = function(config, callback) {
  var actions = [];
  config.forEach(function(feed) {
    actions.push(function (callback) { processFeed(feed, callback); });
  });
  async.parallel(actions, callback);
};