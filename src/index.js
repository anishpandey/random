import { Router } from "@fastly/expressly";
const ipaddr = require('ipaddr.js');

const router = new Router();

// The name of a backend server associated with this service.
// When configuring the backend using Fastly's UI, make sure it points to "dns.google.com".
const backend = "origin_0";

// The outcome of a lookup request.
class Outcome {
  // The client request had no query string.
  static MissingQueryString() {return new Outcome('error', 'Missing query string ?ip=a.b.c.d', 400)};
  // The client request had an invalid query string.
  static InvalidQueryString() {return new Outcome('error', 'Invalid query string ?ip=a.b.c.d', 400)};
  // Google DNS failed.
  static GoogleDnsFailed() {return new Outcome('error', 'Google DNS failed', 502)};
  // The client request came from a googlebot.
  static IsGoogleBot(ptr_record) {return new Outcome('yes', `Reverse lookup is ${ptr_record}`, 200)};
  // The client request did not come from a googlebot.
  static NotGoogleBot(ptr_record) {return new Outcome('no', `Reverse lookup is ${ptr_record}, not an *.google.com or *.googlebot.com domain.`, 200)};
  // No PTR Answer was found.
  static NoPtrAnswer() {return new Outcome('no', 'No PTR Answer for this reverse lookup.', 200)};

  constructor(result, reason, http_status) {
    this.response = new Response(JSON.stringify({result:result, reason:reason}), {'status': http_status, 'headers': {'x-googlebot-verified-reason': reason, 'x-googlebot-verified': result}});
  }
}

// Function to handle the lookup
async function handle_lookup_request(req) {

  // Obtain the IP from the QS parameter.
  if(!req.query.get("ip")){
    // Handling missing QS parameter
    return Outcome.MissingQueryString();
  }

  let addr = ipaddr.parse(req.query.get("ip"));

  if(!addr){
    // Handling invalid IPv4
    return Outcome.InvalidQueryString();
  }

  // Issue the lookup request
  let newReq = new Request(`https://dns.google.com/resolve?name=${addr.octets[3]}.${addr.octets[2]}.${addr.octets[1]}.${addr.octets[0]}.in-addr.arpa&type=PTR`)
  let beresp = await fetch(newReq, { backend });

  if(beresp.status != 200){
    // Handle an error response from Google lookup service.
    return Outcome.GoogleDnsFailed();
  }

  // Obtain the response body as a JSON object.
  let berespBody = await beresp.json();

  if(!berespBody.Answer){
    // Handle a response with no answer
    return Outcome.NoPtrAnswer();
  }
  
  let ptr_record = berespBody.Answer[0].data;

  if(ptr_record.endsWith(".google.com.") || ptr_record.endsWith("googlebot.com."))
  {
    // Handle a positive match
    return Outcome.IsGoogleBot(ptr_record);
  }else{
    // Handle a negative match
    return Outcome.NotGoogleBot(ptr_record);
  }
} 


// Router to handle requests built using Fastly's Expressly
// More info about it here: https://expressly.edgecompute.app/
router.get("/verify", async (req, res) => {
  // Do the lookup
  let lookup = await handle_lookup_request(req);
  // Return the response to the end user
  return res.send(lookup.response);
});

router.listen();