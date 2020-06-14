const Bluebird = require("bluebird");
const Imap = require("imap");
const MailParser = require("mailparser").MailParser;
const cheerio = require("cheerio");
const fs = require("fs");
const base64  = require("base64-stream");

// Creating IMAP instance with configuration
const imap = new Imap({
  user: "jeandaviran@gmail.com",
  password: "",
  host: "imap.gmail.com",
  port: 993,
  tls: true,
  tlsOptions: {
    rejectUnauthorized: false,
  },
  authTimeout: 3000,
});

process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;

function toUpper(thing) {
  return thing && thing.toUpperCase ? thing.toUpperCase() : thing;
}

function findAttachmentParts(struct, attachments) {
  attachments = attachments || [];
  for (var i = 0, len = struct.length, r; i < len; ++i) {
    if (Array.isArray(struct[i])) {
      findAttachmentParts(struct[i], attachments);
    } else {
      if (
        struct[i].disposition &&
        ["INLINE", "ATTACHMENT"].indexOf(toUpper(struct[i].disposition.type)) >
          -1
      ) {
        attachments.push(struct[i]);
      }
    }
  }
  return attachments;
}

function buildAttMessageFunction(attachment) {
  var filename = attachment.params.name;
  var encoding = attachment.encoding;
  
  return function(msg, seqno) {    
    msg.on("body", function(stream, info) {      
      //Create a write stream so that we can stream the attachment to file;
      console.log("Streaming this attachment to file", filename, info);
      var writeStream = fs.createWriteStream('2'+filename);
      writeStream.on("finish", function() {
        console.log("Finalizo la descarga %s", filename);
      });

      // stream.pipe(writeStream); this would write base64 data to the file.
      // so we decode during streaming using
      if (toUpper(encoding) === "BASE64") {        
        if (encoding === 'BASE64') stream.pipe(new base64.Base64Decode()).pipe(writeStream)              
      }
    });
    msg.once("end", function() {
      console.log("Inicia la descarga %s", filename);      
    });
  };
}

imap.once("ready", function() {
  imap.openBox("INBOX", true, function(err, box) {
    if (err) throw err;
    var f = imap.seq.fetch(box.messages.total + ":*", {
      bodies: ["HEADER.FIELDS (FROM)", "TEXT"],
      struct: true
    });
    f.on("message", function(msg, seqno) {      
      msg.on("body", function(stream, info) {
        var buffer = "";
        stream.on("data", function(chunk) {
          buffer += chunk.toString("utf8");
        });
        stream.once("end", function() {
          //Asunto
          let title = Imap.parseHeader(buffer);
          console.log('Asunto: ' + title.from);
          //Mensaje
          const $ = cheerio.load(buffer);
          let message = $("div").text();          
          if (message.length > 0) console.log("Mensaje:" + $("div").text());
        });
      });
      msg.once("attributes", function(attrs) {
        var attachments = findAttachmentParts(attrs.struct);
        console.log("Archivos: %d", attachments.length);
        for (var i = 0, len = attachments.length; i < len; ++i) {
          var attachment = attachments[i];
          console.log(
            "Fetching attachment %s",
            attachment.params.name
          );
          var f = imap.fetch(attrs.uid, {
            //do not use imap.seq.fetch here
            bodies: [attachment.partID],
            struct: true
          });
          //build function to process attachment message
          f.on("message", buildAttMessageFunction(attachment));
        }
      });
      msg.once("end", function() {
        console.log("Finished email");
      });
    });
    f.once("error", function(err) {
      console.log("Fetch error: " + err);
    });
    f.once("end", function() {
      console.log("Done fetching all messages!");
      imap.end();
    });
  });
});

imap.once("error", function(err) {
  console.log(err);
});

imap.once("end", function() {
  console.log("Connection ended");
});

imap.connect();
