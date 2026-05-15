import { makeAutoObservable } from "mobx";
import { User } from "../types/user";

class UserStore {
    user: User | null = null;

    constructor() {
        makeAutoObservable(this);
    }

    getUser() {
        return this.user;
    }

    setUser(user: User | null) {
        this.user = user;
    }
}

export const userStore = new UserStore();
