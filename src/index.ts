import { config as dotenv } from "dotenv";
import { spawn } from "child_process";
import { homedir } from "os";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { inspect } from "util";
import fetch, { Response } from "node-fetch";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { Consola, default as consola } from "consola";
import { Status as Tweet } from "twitter-d";
import { VideoVariant } from "twitter-d/types/video_variant";
import { FullUser, User } from "twitter-d/types/user";

interface Arguments {
  tweetID: string;
  "api-key": string;
  destination: string;
  limit: number;
  "stop-at"?: string;
  verbose: number;
}

function isFullUser(user: User): user is FullUser {
  return "screen_name" in user;
}

dotenv();

let log: Consola,
  cliArgs: Arguments,
  tweetCounter = 0,
  stopAtTweetInt: BigInt | false;
const failedDownloads = new Map<string, string>();

async function handleCommand(argv: Arguments) {
  cliArgs = argv;
  log = consola.create({ level: 3 + argv.verbose });
  stopAtTweetInt = argv["stop-at"] ? BigInt(argv["stop-at"]) : false;

  if (!existsSync(argv.destination)) {
    try {
      mkdirSync(argv.destination, { recursive: true });
    } catch (e) {
      log.error({
        message:
          "Encountered an error attempting to create destination directory",
        additional: e,
      });

      process.exit(1);
    }
  }

  log.info("Started twitter thread downloads!");

  await downloadTweet(argv.tweetID);
}

function downloadTweet(tweetID: string): Promise<void> {
  log.debug(`Fetching ${tweetID}.`);

  if (BigInt(tweetID) <= stopAtTweetInt) {
    reportExit({
      message: `Reached or passed the requested id.`,
      additional: "…exiting cleanly",
    });

    process.exit(0);
  }

  return getTweetJson(tweetID)
    .then(fetchVideo)
    .catch((error) => {
      log.error(error);

      process.exit(1);
    })
    .then(findNextTweet)
    .then(downloadTweet);
}

class HTTPResponseError extends Error {
  private response: Response;
  constructor(response: Response) {
    super(`HTTP Error Response: ${response.status} ${response.statusText}`);

    this.response = response;
  }
}

function getTweetJson(tweetID: string): Promise<Tweet> {
  return fetch(
    `https://api.twitter.com/1.1/statuses/show.json?id=${tweetID}&tweet_mode=extended`,
    { headers: { Authorization: `Bearer ${cliArgs["api-key"]}` } }
  )
    .then((res) => {
      if (res.ok) {
        return res.json() as Promise<Tweet>;
      }

      failedDownloads.set(
        tweetID,
        `Download failed with a ${res.status} error.`
      );

      throw new HTTPResponseError(res);
    })
    .catch((error) => {
      log.error({
        message: `Failure downloading tweet`,
        additional: [error.response.text()],
      });

      reportExit({
        message: "Nothing left to download, exiting cleanly.",
        additional: "Couldn't find next tweet in thread",
      });

      process.exit(1);
    });
}

async function fetchVideo(tweet: Tweet) {
  log.success(`Fetched Tweet ${tweet.id_str}`);
  log.trace({
    message: "Here's some JSON.",
    additional: inspect(tweet, { colors: true, depth: 10 }),
  });

  if (!tweet.extended_entities) {
    log.debug("Fetched tweet does not have any media associated with it");

    if (tweet.quoted_status_id_str) {
      log.debug(`Checking quoted tweet ${tweet.quoted_status_id_str}`);

      await getTweetJson(tweet.quoted_status_id_str).then(fetchVideo);
    }

    return tweet;
  }

  log.trace({
    message:
      "Making an assumption here that the TikTok video is the only media on the tweet",
    additional: inspect(tweet.extended_entities.media, {
      colors: true,
      depth: 10,
    }),
  });

  const videoInfo =
    tweet.extended_entities.media?.[0].video_info?.variants?.filter(
      (variant: VideoVariant) =>
        variant.content_type === "application/x-mpegURL"
    );

  if (!videoInfo) {
    log.debug("Video info was not usable, moving on");

    return tweet;
  }

  log.debug(`Spawning ffmpeg to download video from ${tweet.id_str}.`);

  return await runFfmpeg(tweet, videoInfo[0].url);
}

function runFfmpeg(tweet: Tweet, url: string): Promise<Tweet> {
  let metadata: string[] = [];

  if (isFullUser(tweet.user)) {
    metadata = [
      "-metadata",
      "media_type=0",
      "-metadata",
      `description="${tweet.full_text}"`,
      "-metadata",
      `comment="${tweet.user.name} @${tweet.user.screen_name}"`,
      "-metadata",
      `synopsis="https://twitter.com/${tweet.user.screen_name}/status/${tweet.id_str}/"`,
    ];
  }

  return new Promise((resolve) => {
    const ffmpegReq = spawn("ffmpeg", [
      "-i",
      url,
      ...metadata,
      "-c",
      "copy",
      join(cliArgs.destination, `${tweet.id_str}.mp4`),
    ]);
    const fFmpegOutput = new Set<string>();
    const ffmpegCheckin = setInterval(() => {
      log.debug(`ffmpeg still running on ${tweet.id_str}`);
      log.trace({
        message: "stderr so far",
        additional: [...fFmpegOutput].join("\n"),
      });
      fFmpegOutput.clear();
    }, 30000);
    const ffmpegTimeout = setTimeout(() => {
      log.debug(`${tweet.id_str} took too long, killing process.`);
      log.trace({
        message: "stderr remaining",
        additional: [...fFmpegOutput].join("\n"),
      });

      fFmpegOutput.clear();
      clearInterval(ffmpegCheckin);
      ffmpegReq.kill();
      failedDownloads.set(tweet.id_str, "timeout");
      log.warn(`Failed to download ${tweet.id_str} (timeout)`);

      resolve(tweet);
    }, 300000);

    ffmpegReq.stderr.on("data", (data) => {
      if (data.includes("already exists. Overwrite? [y/N]")) {
        log.warn(`${tweet.id_str} video already exists, moving on.`);

        failedDownloads.set(tweet.id_str, "already exists");
        ffmpegReq.kill();

        resolve(tweet);
      }
      fFmpegOutput.add(data);
      log.trace(`${data}`);
    });

    ffmpegReq.on("close", (code) => {
      clearInterval(ffmpegCheckin);
      clearTimeout(ffmpegTimeout);

      if (code === 0) {
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

function findNextTweet(tweet: Tweet): string {
  tweetCounter++;

  if (tweetCounter >= cliArgs.limit) {
    reportExit({
      message: "Reached the limit of tweets to process",
      additional: "…exiting cleanly",
    });

    process.exit(0);
  }

  if (tweet.in_reply_to_status_id_str) {
    return tweet.in_reply_to_status_id_str;
  }

  reportExit({
    message: "Reached the beginning of the thread.",
    additional: "",
  });

  process.exit(0);
}

function reportExit({
  message,
  additional,
}: {
  message: string;
  additional: string | string[];
}) {
  const failuresLog = [...failedDownloads.entries()].map(
    ([tweetID, reason]) => `${tweetID} (${reason})`
  );

  log.success({ message, additional });

  if (failuresLog.length > 0) {
    log.warn({
      message: "The following tweets failed to download:",
      additional: failuresLog,
    });
  }

  log.info(
    `Exiting after ${tweetCounter} videos successfully downloaded and ${failuresLog.length} failures.`
  );
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
      default: join(homedir(), "Downloads"),
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
