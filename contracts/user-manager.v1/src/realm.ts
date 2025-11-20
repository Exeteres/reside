import type { UserManagerData } from "./contract"
import { box, LocalizedDisplayInfo, loadBoxed } from "@reside/shared"
import { type Account, co, Group, z } from "jazz-tools"
import { User } from "./user"

export type Realm = co.loaded<typeof Realm>
export type RealmDefinition = co.loaded<typeof RealmDefinition>

export const RealmDefinition = co.map({
  /**
   * The display information about the realm.
   */
  displayInfo: LocalizedDisplayInfo.optional(),

  /**
   * Whether the realm is open for self-registration (of unmanaged users) or only managed users can be added by accounts with "realm:user:register" permission.
   */
  isOpen: z.boolean(),
})

export const Realm = co.map({
  /**
   * The unique sequential ID of the realm.
   */
  id: z.number(),

  /**
   * The unique name of this realm within the User Manager Replica.
   */
  name: z.string(),

  /**
   * The definition of this realm writable by accounts with `realm:definition:manage` permission.
   */
  definition: RealmDefinition,

  get users() {
    return co.list(User)
  },

  /**
   * The owner account of this realm.
   *
   * Sets to the account first creating the realm.
   */
  owner: co.account(),

  /**
   * The group for users allowed to impersonate managed user accounts in this realm.
   */
  impersonateUsersGroup: co.group(),
})

/**
 * Returns the realm with the given name, creating it if it does not exist.
 *
 * @param data The User Manager contract data.
 * @param name The name of the realm.
 * @param owner The owner account for the realm if created.
 */
export async function getOrCreateRealm(
  data: UserManagerData,
  name: string,
  owner: Account,
): Promise<Realm> {
  const realm = await getRealmByName(data, name)
  if (realm) {
    return realm
  }

  const loadedData = await data.$jazz.ensureLoaded({
    resolve: { realms: true },
  })

  const newRealm = Realm.create({
    id: loadedData.realms.length + 1,
    name,
    definition: RealmDefinition.create({ isOpen: false }),
    owner,
    users: [],
    impersonateUsersGroup: Group.create(),
  })

  // create index to lookup by name
  box(Realm).create(
    { value: newRealm },
    {
      owner: data.$jazz.owner,
      unique: `realm.by-name.${name}`,
    },
  )

  // create index to lookup by id
  box(Realm).create(
    { value: newRealm },
    {
      owner: data.$jazz.owner,
      unique: `realm.by-id.${newRealm.id}`,
    },
  )

  // allow accounts with "realm:read:all" permission to read this realm
  newRealm.$jazz.owner.addMember(loadedData.$jazz.owner, "reader")

  // allow accounts with access to realm to read its definition
  newRealm.definition.$jazz.owner.addMember(newRealm.$jazz.owner, "reader")

  // add to realms list
  loadedData.realms.$jazz.push(newRealm)

  return newRealm
}

/**
 * Returns the realm by its name, or null if not found.
 *
 * @param data The User Manager contract data.
 * @param name The name of the realm.
 */
export async function getRealmByName(data: UserManagerData, name: string): Promise<Realm | null> {
  return await loadBoxed(
    Realm,
    `realm.by-name.${name}`,
    data.$jazz.owner.$jazz.id,
    data.$jazz.loadedAs,
  )
}

/**
 * Returns the realm by its unique identifier, or null if not found.
 *
 * @param data The User Manager contract data.
 * @param id The unique identifier of the realm.
 */
export async function getRealmById(data: UserManagerData, id: number): Promise<Realm | null> {
  return await loadBoxed(Realm, `realm.by-id.${id}`, data.$jazz.owner.$jazz.id, data.$jazz.loadedAs)
}
