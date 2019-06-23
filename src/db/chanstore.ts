import { IDatabaseConnector, ISqlRow } from "./connector";
import { Log } from "../log";
import { TimedCache } from "../structures/timedcache";

const log = new Log("DbChanStore");

const CHAN_CACHE_LIFETIME = 1000*60*60*24;

export interface IChanStoreEntry {
	mxid: string;
	roomId: string;
	puppetId: number;
	name?: string | null;
	avatarUrl?: string | null;
	avatarMxc?: string | null;
	topic?: string | null;
}

export class DbChanStore {
	private remoteCache: TimedCache<string, IChanStoreEntry>;
	private mxidCache: TimedCache<string, IChanStoreEntry>;
	private opCache: TimedCache<string, string>;
	constructor (
		private db:IDatabaseConnector,
	) {
		this.remoteCache = new TimedCache(CHAN_CACHE_LIFETIME);
		this.mxidCache = new TimedCache(CHAN_CACHE_LIFETIME);
		this.opCache = new TimedCache(CHAN_CACHE_LIFETIME);
	}

	public newData(mxid: string, roomId: string, puppetId: number): IChanStoreEntry {
		return {
			mxid,
			roomId,
			puppetId,
		} as IChanStoreEntry;
	}

	public async getByRemote(puppetId: number, roomId: string): Promise<IChanStoreEntry | null> {
		const cached = this.remoteCache.get(`${puppetId};${roomId}`);
		if (cached) {
			return cached;
		}
		const row = await this.db.Get(
			"SELECT * FROM chan_store WHERE room_id = $room_id AND puppet_id = $puppet_id", {
			room_id: roomId,
			puppet_id: puppetId,
		});
		return this.getFromRow(row);
	}

	public async getByMxid(mxid: string): Promise<IChanStoreEntry | null> {
		const cached = this.mxidCache.get(mxid);
		if (cached) {
			return cached;
		}
		const row = await this.db.Get(
			"SELECT * FROM chan_store WHERE mxid = $mxid", { mxid }
		);
		return this.getFromRow(row);
	}

	public async set(data:IChanStoreEntry) {
		const exists = await this.db.Get(
			"SELECT * FROM chan_store WHERE mxid = $mxid", {mxid: data.mxid}
		);
		let query = "";
		if (!exists) {
			query = `INSERT INTO chan_store (
				mxid,
				room_id,
				puppet_id,
				name,
				avatar_url,
				avatar_mxc,
				topic
			) VALUES (
				$mxid,
				$room_id,
				$puppet_id,
				$name,
				$avatar_url,
				$avatar_mxc,
				$topic
			)`;
		} else {
			query = `UPDATE chan_store SET
				room_id = $room_id,
				puppet_id = $puppet_id,
				name = $name,
				avatar_url = $avatar_url,
				avatar_mxc = $avatar_mxc,
				topic = $topic
				WHERE mxid = $mxid`;
		}
		await this.db.Run(query, {
			mxid: data.mxid,
			room_id: data.roomId,
			puppet_id: data.puppetId,
			name: data.name || null,
			avatar_url: data.avatarUrl || null,
			avatar_mxc: data.avatarMxc || null,
			topic: data.topic || null,
		});
		this.remoteCache.set(`${data.roomId}_${data.puppetId}`, data);
		this.mxidCache.set(data.mxid, data);
	}

	public async setChanOp(chanMxid: string, userMxid: string) {
		const row = await this.db.Get("SELECT * FROM chan_op WHERE chan_mxid=$chan AND user_mxid=$user", {
			chan: chanMxid,
			user: userMxid,
		});
		if (row) {
			// nothing to do, we are already one
			return;
		}
		await this.db.Run("INSERT INTO chan_op (chan_mxid, user_mxid) VALUES ($chan, $user)", {
			chan: chanMxid,
			user: userMxid,
		});
		this.opCache.set(chanMxid, userMxid);
	}

	public async getChanOp(chanMxid: string): Promise<string|null> {
		const cached = this.opCache.get(chanMxid);
		if (cached) {
			return cached;
		}
		const row = await this.db.Get("SELECT user_mxid FROM chan_op WHERE chan_mxid=$chan", {
			chan: chanMxid,
		});
		if (!row) {
			return null;
		}
		const userMxid = row.user_mxid as string;
		this.opCache.set(chanMxid, userMxid);
		return userMxid
	}

	private getFromRow(row: ISqlRow | null): IChanStoreEntry | null {
		if (!row) {
			return null;
		}
		const data = this.newData(
			row.mxid as string,
			row.room_id as string,
			row.puppet_id as number,
		);
		data.name = row.name as string | null;
		data.avatarUrl = row.avatar_url as string | null;
		data.avatarMxc = row.avatar_mxc as string | null;
		data.topic = row.topic as string | null;

		this.remoteCache.set(`${data.puppetId};${data.roomId}`, data);
		this.mxidCache.set(data.mxid, data);
		return data;
	}
}