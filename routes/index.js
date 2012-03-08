
/*
 * GET home page.
 */

exports.index = function(req, res){
  res.render('index', { 
  	title: 'Full Feeds', 
  	locals: { feeds: [{name: 'A', url: 'http://foo', selector: 'body'}, {name: 'B', url: 'http://bar', selector: 'body table'}]} 
  });
};