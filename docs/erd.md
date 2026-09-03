# BD Railway ERD

This ERD documents the relational model implemented in `database/schema.sql`.
`PK` denotes a primary key and `FK` denotes a foreign key. `user_auth` and
`auth_session` are deliberate additive authentication tables: the original
`users` entity has no password or session fields.

```mermaid
erDiagram
    STATION {
        varchar station_code PK
        varchar station_name
        varchar city
    }
    ROUTE {
        int route_id PK
        varchar route_name
    }
    ROUTE_STATION {
        int route_id PK, FK
        varchar station_code PK, FK
        int stop_order
    }
    TRAIN {
        int train_id PK
        varchar train_name
    }
    COACH {
        int coach_id PK
        int train_id FK
        int coach_number
        varchar coach_type
        int capacity
    }
    SEAT {
        int seat_id PK
        int coach_id FK
        varchar seat_number
        varchar seat_type
    }
    TRIP {
        int trip_id PK
        int train_id FK
        int route_id FK
        timestamp departure_date
        varchar status
    }
    USERS {
        int user_id PK
        varchar first_name
        varchar last_name
        varchar email UK
        varchar role
    }
    USER_AUTH {
        int user_id PK, FK
        varchar password_hash
    }
    AUTH_SESSION {
        uuid jti PK
        int user_id FK
        timestamp expires_at
        timestamp revoked_at
    }
    BOOKING {
        varchar pnr_number PK
        int user_id FK
        varchar starts_at_station FK
        varchar ends_at_station FK
        timestamp booking_date
        varchar booking_status
        numeric fare
    }
    TICKET {
        int ticket_id PK
        varchar pnr_number FK
        int trip_id FK
        int seat_id FK
        varchar passenger_name
        int passenger_age
        numeric price
    }
    PAYMENT {
        int payment_id PK
        varchar pnr_number FK
        numeric amount
        varchar payment_method
    }

    ROUTE ||--|{ ROUTE_STATION : contains
    STATION ||--o{ ROUTE_STATION : appears_on
    TRAIN ||--|{ COACH : has
    COACH ||--|{ SEAT : contains
    TRAIN ||--o{ TRIP : operates
    ROUTE ||--o{ TRIP : follows
    USERS ||--|| USER_AUTH : authenticates_with
    USERS ||--o{ AUTH_SESSION : has
    USERS ||--o{ BOOKING : creates
    STATION ||--o{ BOOKING : origin_or_destination
    BOOKING ||--|{ TICKET : contains
    TRIP ||--o{ TICKET : occurs_on
    SEAT ||--o{ TICKET : assigns
    BOOKING ||--o| PAYMENT : is_paid_by
```

## Key business constraints

- A route station’s `stop_order` determines which station precedes another on
  a route.
- A coach number is unique within a train; a seat number is unique within a
  coach.
- A booking has a unique PNR and belongs to exactly one user.
- A ticket joins a booking, a trip, and a physical seat.
- An authentication session belongs to one user and can be revoked at logout.
