import { config as dotenv } from "dotenv";
import { spawn } from "child_process";
import { homedir } from "os";
import * as path from "path";
import * as util from "util";
import fetch from "node-fetch";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { Consola, default as consola } from "consola";
import { Status as Tweet } from "twitter-d";
import { VideoVariant } from "twitter-d/types/video_variant";
import exp from "constants";

interface Arguments {
  tweetID: string;
  "api-key": string;
  destination: string;
  limit: number;
  "stop-at"?: string;
  verbose: number;
}

dotenv();

let log: Consola,
  cliArgs: Arguments,
  tweetCounter = 0;
const failedDownloads = new Set<string>();

async function handleCommand(argv: Arguments) {
  cliArgs = argv;
  log = consola.create({ level: 3 + argv.verbose });

  log.info("Started twitter thread downloads!");

  await downloadTweet(argv.tweetID);
}

function downloadTweet(tweetID: string): Promise<void> {
  log.debug(`Fetching ${tweetID}.`);

  return fetch(`https://api.twitter.com/1.1/statuses/show.json?id=${tweetID}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${cliArgs["api-key"]}` },
  })
    .then((res) => res.json())
    .then(fetchVideo)
    .catch((error) => {
      log.error(error);

      process.exit(1);
    })
    .then((tweet: Tweet) => {
      tweetCounter++;

      if (tweetCounter >= cliArgs.limit) {
        log.success({
          message: "Reached the limit of tweets processed",
          additional: "…exiting cleanly",
        });

        process.exit(0);
      }

      if (tweet.in_reply_to_status_id_str) {
        return tweet.in_reply_to_status_id_str;
      }

      if (cliArgs["stop-at"] && BigInt(tweetID) < BigInt(cliArgs["stop-at"])) {
        log.success({
          message: `Reached the requested id after ${tweetCounter} tweets.`,
          additional: "…exiting cleanly",
        });
        process.exit(0);
      }

      log.success({
        message: "Reached the beginning of the thread.",
        additional: `Downloaded a total of ${tweetCounter} videos.`,
      });

      process.exit(0);
    })
    .then(downloadTweet);
}

async function fetchVideo(tweet: Tweet) {
  log.success(`Fetched Tweet ${tweet.id_str}`);
  log.trace({
    message: "Here's some JSON.",
    additional: util.inspect(tweet, { colors: true, depth: 10 }),
  });

  if (!tweet.extended_entities) {
    log.debug("Fetched tweet does not have any media associated with it");

    return tweet;
  }

  log.trace({
    message:
      "Making an assumption here that the TikTok video is the only media on the tweet",
    additional: util.inspect(tweet.extended_entities.media, {
      colors: true,
      depth: 10,
    }),
  });

  const videoInfo = tweet?.extended_entities?.media?.[0]?.video_info?.variants?.filter(
    (variant: VideoVariant) => variant.bitrate !== undefined
  );

  if (!videoInfo) {
    return tweet;
  }

  videoInfo.sort((a, b) => ((a?.bitrate ?? 0) < (b?.bitrate ?? 0) ? 1 : -1));

  log.trace({
    message: "Variants sorted",
    additional: videoInfo.reduce(
      (prev, current) => `${prev} ${current.bitrate},`,
      "Bitrates: "
    ),
  });

  log.debug(`Spawning ffmpeg to download video from ${tweet.id_str}.`);

  return await runFfmpeg(tweet, videoInfo[0].url);
}

function runFfmpeg(tweet: Tweet, url: string): Promise<Tweet> {
  return new Promise((resolve) => {
    const ffmpegReq = spawn("ffmpeg", [
      "-i",
      url,
      "-c",
      "copy",
      path.join(cliArgs.destination, `${tweet.id_str}.mp4`),
    ]);
    const fFmpegOutput = new Set<string>();
    const ffmpegCheckin = setInterval(() => {
      log.debug(`ffmpeg still running on ${tweet.id_str}`);
      log.trace({
        message: "stderr so far",
        additional: Array.from(fFmpegOutput.values()).join("\n"),
      });
      fFmpegOutput.clear();
    }, 30000);
    const ffmpegTimeout = setTimeout(() => {
      log.debug(`${tweet.id_str} took too long, killing process.`);
      log.trace({
        message: "stderr remaining",
        additional: Array.from(fFmpegOutput.values()).join("\n"),
      });

      fFmpegOutput.clear();
      clearInterval(ffmpegCheckin);
      ffmpegReq.kill();
      failedDownloads.add(tweet.id_str);
      log.warn(`Failed to download ${tweet.id_str} (timeout)`);
    }, 300000);

    ffmpegReq.stderr.on("data", (data) => {
      fFmpegOutput.add(data);
      // TODO: check `data` for overwrite message
      log.trace(`${data}`);
    });

    ffmpegReq.on("close", (code) => {
      clearInterval(ffmpegCheckin);
      clearTimeout(ffmpegTimeout);

      if (code && code === 0) {
        log.debug(`ffmpeg finished ${tweet.id_str} exiting with code ${code}.`);
      } else {
        log.error(
          `ohno ffmpeg failed ${tweet.id_str} exiting with code ${code}.`
        );
      }

      resolve(tweet);
    });
  });
}

export default function () {
  yargs(hideBin(process.argv))
    .env("TWITTER")
    .command(
      "$0 [options] <tweetID>",
      "Fetch all videos from a Twitter (TikTok) thread",
      (yargs) => {
        yargs.positional("tweetID", {
          describe:
            "The ID of the most recent tweet to begin working backward from",
          type: "string",
        });
      },
      handleCommand
    )
    .option("api-key", {
      alias: "k",
      demandOption: "Twitter API key is required",
      describe:
        "Your Twitter API key (will overwrite env variable `TWITTER_API_KEY`)",
      nargs: 1,
      type: "string",
    })
    .option("destination", {
      alias: "d",
      default: path.join(homedir(), "Downloads"),
      defaultDescription: "~/Downloads",
      describe: "Download destination folder for videos.",
      nargs: 1,
      type: "string",
    })
    .option("limit", {
      alias: "l",
      default: Infinity,
      describe: "Limit the total number of tweets to process.",
      nargs: 1,
      type: "number",
    })
    .option("stop-at", {
      alias: "s",
      describe:
        "A tweet ID at which point to stop recursively downloading. Helpful if you've already downloaded this thread before.",
      nargs: 1,
      type: "string",
    })
    .option("verbose", {
      alias: "v",
      count: true,
      default: 0,
      describe: 'Chatty logs. More "v"s for more logging.',
      nargs: 0,
      type: "boolean",
    })
    .help().argv;
}
