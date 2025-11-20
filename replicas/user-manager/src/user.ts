import { type Realm, User, type UserManagerData } from "@contracts/user-manager.v1"
import { box } from "@reside/shared"
import { type Account, Group } from "jazz-tools"

export async function createUser(
  data: UserManagerData,
  account: Account,
  realm?: Realm,
  isManaged = false,
): Promise<User> {
  const loadedData = await data.$jazz.ensureLoaded({
    resolve: {
      users: true,
      defaultRealm: true,
      managePermissionsGroup: true,
    },
  })

  // create new user
  const user = User.create(
    {
      id: loadedData.users.length + 1,
      realm: realm ?? loadedData.defaultRealm,
      account,
      isManaged,
      permissionSets: [],
    },
    Group.create(loadedData.$jazz.loadedAs as Account),
  )

  // add user to the users list
  loadedData.users.$jazz.push(user)

  // allow readers of user list also read the new user
  user.$jazz.owner.addMember(loadedData.users.$jazz.owner, "reader")

  // add user to the realm's users list
  const loadedRealm = await user.realm.$jazz.ensureLoaded({ resolve: { users: true } })
  loadedRealm.users.$jazz.push(user)

  // allow readers of realm's users also read the new user
  user.$jazz.owner.addMember(loadedRealm.users.$jazz.owner, "reader")

  // create indexes for the new user
  box(User).create(
    { value: user },
    {
      owner: loadedData.$jazz.owner,
      unique: `user.by-id.${user.id}`,
    },
  )

  box(User).create(
    { value: user },
    {
      owner: loadedData.$jazz.owner,
      unique: `user.by-account.${account.$jazz.id}`,
    },
  )

  // allow users with "permission:manage:all" to manage permissions of the new user and read the user
  user.permissionSets.$jazz.owner.addMember(loadedData.managePermissionsGroup, "writer")
  user.$jazz.owner.addMember(loadedData.managePermissionsGroup, "reader")

  // allow account itself read access to the user and permission sets
  user.$jazz.owner.addMember(account, "reader")
  user.permissionSets.$jazz.owner.addMember(account, "reader")

  return user
}
