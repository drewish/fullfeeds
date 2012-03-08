/**
 * Module dependencies.
 */

var express = require('express')
   , routes = require('./routes')
   , redis = require('redis')
   , redisStore = require('connect-redis')(express);

var app = module.exports = express.createServer()
   , redisClient = redis.createClient();


var feeds = [
  {
    name: 'plumline',
    url: 'http://feeds.washingtonpost.com/rss/rss_plum-line',
    urlExtractor: function(article) {
      // Skip ads.
      return (article.link.indexOf("ads.pheedo.com") === -1) ? article.guid : false;
    },
    selector: '#entrytext',
  },
  {
    name: 'taibbi',
    url: 'http://www.rollingstone.com/siteServices/rss/taibbiBlog',
    selector: '.blog-post-content'
  },
  {
    name: 'paulgraham',
    url: 'http://www.aaronsw.com/2002/feeds/pgessays.rss',
    selector: 'table table tr td'
  }
];

function findFeed(name) {
  for (var i = feeds.length - 1; i >= 0; i--) {
    if (feeds[i].name === name) {
      return i;
    }
  };
  return -1;
}

function loadFeed(name) {
  var index = findFeed(name);
  if (index > -1) {
    return feeds[index];
  }
}

function addFeed(name, url, selector) {
  feeds.push({'name': name, 'url': url, 'selector': selector});
}

function saveFeed(name, url, selector) {
  var index = findFeed(name);
  if (index > -1) {
    feeds[index].url = url;
    feeds[index].selector = selector;
  }
  else {
    addFeed(name, url, selector);
  }
}

function deleteFeed(name) {
  var index = findFeed(name);
  if (index > -1) {
    feeds.splice(index, 1);
  }
}


// Configuration

app.configure(function(){
  app.set('views', __dirname + '/views');
  app.set('view engine', 'jade');
  app.use(express.bodyParser());
  app.use(express.methodOverride());
  app.use(express.cookieParser());
  app.use(express.session({ store: new redisStore({client: redisClient}), secret: 'some secret here' }));
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

app.get('/', function(req, res) {
  res.render('index', { 
    title: 'Full Feeds', 
    locals: { feeds: feeds} 
  });
});

app.get('/edit/:name', function(req, res) {
  var feed = loadFeed(req.params.name);
  res.render('feed/edit', { 
    title: 'Edit Feed', 
    locals: { feed: feed} 
  });
});
app.post('/edit/:name', function(req, res) {
  //addFeed('new', 'http://example.com', 'body');
  res.redirect('/');
});

app.get('/delete/:name', function(req, res) {
  var feed = loadFeed(req.params.name);
  res.render('feed/delete', { 
    title: 'Delete Feed', 
    locals: { feed: feed} 
  });
});
app.post('/delete/:name', function(req, res) {
  deleteFeed(req.params.name);
  res.redirect('/');
});

app.get('/view/:name', function(req, res) {
  var feed = loadFeed(req.params.name);
  res.render('feed/view', { 
    title: 'Delete Feed', 
    locals: { feed: feed} 
  });
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

